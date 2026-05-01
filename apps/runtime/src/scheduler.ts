import { readFile } from "node:fs/promises";
import {
  listOrchestratorSchedules,
  type MinKbWorkspace,
  updateOrchestratorSchedule,
} from "@min-kb-app/min-kb-store";
import type {
  OrchestratorJob,
  OrchestratorSchedule,
  OrchestratorScheduleCreateRequest,
  OrchestratorScheduleUpdateRequest,
  ScheduleTask,
  ScheduleTaskCreateRequest,
  ScheduleTaskUpdateRequest,
} from "@min-kb-app/shared";
import { DateTime } from "luxon";
import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { readRuntimeSmtpEnv } from "./env.js";
import type { TmuxOrchestratorService } from "./orchestrator.js";

const DAY_OF_WEEK_TO_LUXON: Record<
  NonNullable<OrchestratorSchedule["dayOfWeek"]>,
  number
> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

export class OrchestratorScheduleService {
  private timer: NodeJS.Timeout | undefined;

  private busy = false;

  private mailer: Transporter | undefined;

  constructor(
    private readonly workspace: MinKbWorkspace,
    private readonly orchestrator: TmuxOrchestratorService,
    private readonly intervalMs = 60_000
  ) {}

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    void this.tick();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick() {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      const schedules = await listOrchestratorSchedules(this.workspace);
      const now = DateTime.utc();
      for (const schedule of schedules) {
        let current = await this.reconcileScheduleRun(schedule);
        if (!current.enabled) {
          continue;
        }
        const nextRun = DateTime.fromISO(current.nextRunAt, { zone: "utc" });
        if (!nextRun.isValid || nextRun > now) {
          continue;
        }
        const job = await this.orchestrator.triggerSchedule(current);
        current = await updateOrchestratorSchedule(
          this.workspace,
          current.scheduleId,
          {
            lastRunAt: now.toISO() ?? current.lastRunAt,
            lastJobId: job.jobId,
            lastJobStatus: job.status,
            nextRunAt: computeNextRunAt(current, now.plus({ seconds: 1 })),
            totalRuns: current.totalRuns + 1,
            lastCompletedAt: undefined,
            lastEmailAttemptAt: undefined,
            lastEmailAttemptJobId: undefined,
            lastEmailError: undefined,
          }
        );
        await this.reconcileScheduleRun(current);
      }
    } catch (error) {
      console.error("Failed to process orchestrator schedules", error);
    } finally {
      this.busy = false;
    }
  }

  private async reconcileScheduleRun(
    schedule: OrchestratorSchedule
  ): Promise<OrchestratorSchedule> {
    if (!schedule.lastJobId) {
      return schedule;
    }
    const session = await this.orchestrator.getSession(schedule.sessionId);
    const job = session.jobs.find(
      (candidate) => candidate.jobId === schedule.lastJobId
    );
    if (!job) {
      return schedule;
    }

    let nextSchedule = schedule;
    const statusChanged =
      job.status !== schedule.lastJobStatus ||
      job.completedAt !== schedule.lastCompletedAt;
    if (statusChanged) {
      nextSchedule = await updateOrchestratorSchedule(
        this.workspace,
        schedule.scheduleId,
        {
          lastJobStatus: job.status,
          lastCompletedAt: job.completedAt,
          failedRuns:
            job.status === "failed" &&
            job.completedAt &&
            job.completedAt !== schedule.lastCompletedAt
              ? schedule.failedRuns + 1
              : schedule.failedRuns,
        }
      );
    }

    if (
      !nextSchedule.emailTo ||
      !job.completedAt ||
      nextSchedule.lastEmailAttemptJobId === job.jobId
    ) {
      return nextSchedule;
    }

    const attemptedAt = new Date().toISOString();
    try {
      await this.sendCompletionEmail(nextSchedule, session.title, job);
      return updateOrchestratorSchedule(
        this.workspace,
        nextSchedule.scheduleId,
        {
          lastEmailAttemptAt: attemptedAt,
          lastEmailAttemptJobId: job.jobId,
          lastEmailError: undefined,
        }
      );
    } catch (error) {
      return updateOrchestratorSchedule(
        this.workspace,
        nextSchedule.scheduleId,
        {
          lastEmailAttemptAt: attemptedAt,
          lastEmailAttemptJobId: job.jobId,
          lastEmailError:
            error instanceof Error ? error.message : "Unknown email error",
        }
      );
    }
  }

  private async sendCompletionEmail(
    schedule: OrchestratorSchedule,
    sessionTitle: string,
    job: OrchestratorJob
  ) {
    if (!schedule.emailTo) {
      return;
    }
    const transporter = this.getMailer();
    if (!transporter) {
      throw new Error("Email delivery is not configured.");
    }
    const smtp = readRuntimeSmtpEnv();
    const output = await this.readJobOutput(job);
    await transporter.sendMail({
      from: smtp.from,
      to: schedule.emailTo,
      replyTo: smtp.replyTo,
      subject: `[min-kb-app] ${schedule.title} ${job.status === "failed" ? "failed" : "completed"}`,
      text: [
        `Schedule: ${schedule.title}`,
        `Session: ${sessionTitle}`,
        `Status: ${job.status}`,
        `Completed: ${job.completedAt ?? "in progress"}`,
        `Next run: ${schedule.nextRunAt}`,
        "",
        "Prompt:",
        schedule.prompt,
        "",
        "Output:",
        output || "No job output was captured.",
      ].join("\n"),
    });
  }

  private getMailer(): Transporter | undefined {
    const smtp = readRuntimeSmtpEnv();
    if (!smtp.host || !smtp.port || !smtp.normalizedFrom) {
      return undefined;
    }
    if (this.mailer) {
      return this.mailer;
    }
    const port = Number.parseInt(smtp.port, 10);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error("MIN_KB_APP_SMTP_PORT must be a positive integer.");
    }
    const options: SMTPTransport.Options = {
      host: smtp.host,
      port,
      secure: smtp.secure,
    };
    if (smtp.user) {
      options.auth = {
        user: smtp.user,
        pass: smtp.pass ?? "",
      };
    }
    this.mailer = nodemailer.createTransport(options);
    return this.mailer;
  }

  private async readJobOutput(job: OrchestratorJob): Promise<string> {
    if (!job.outputPath) {
      return "";
    }
    try {
      const raw = await readFile(job.outputPath, "utf8");
      return raw.trim().slice(-20_000);
    } catch {
      return "";
    }
  }
}

export function computeNextRunAt(
  schedule:
    | Pick<
        OrchestratorSchedule,
        "frequency" | "timeOfDay" | "timezone" | "dayOfWeek" | "dayOfMonth"
      >
    | Pick<
        ScheduleTask,
        "frequency" | "timeOfDay" | "timezone" | "dayOfWeek" | "dayOfMonth"
      >
    | OrchestratorScheduleCreateRequest
    | OrchestratorScheduleUpdateRequest
    | ScheduleTaskCreateRequest
    | ScheduleTaskUpdateRequest,
  from: DateTime = DateTime.utc()
): string {
  const zonedFrom = ensureTimeZone(schedule.timezone, from);
  const [hour, minute] = parseTimeOfDay(schedule.timeOfDay);
  const base = zonedFrom.set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });

  let next: DateTime;
  switch (schedule.frequency) {
    case "daily": {
      next = base > zonedFrom ? base : base.plus({ days: 1 });
      break;
    }
    case "weekly": {
      if (!schedule.dayOfWeek) {
        throw new Error("Weekly schedules require a day of week.");
      }
      const targetWeekday = DAY_OF_WEEK_TO_LUXON[schedule.dayOfWeek];
      const dayOffset = (targetWeekday - base.weekday + 7) % 7;
      next = base.plus({ days: dayOffset });
      if (next <= zonedFrom) {
        next = next.plus({ weeks: 1 });
      }
      break;
    }
    case "monthly": {
      if (!schedule.dayOfMonth) {
        throw new Error("Monthly schedules require a day of month.");
      }
      next = resolveMonthlyCandidate(base, schedule.dayOfMonth);
      if (next <= zonedFrom) {
        next = resolveMonthlyCandidate(
          base.plus({ months: 1 }),
          schedule.dayOfMonth
        );
      }
      break;
    }
  }

  const iso = next.toUTC().toISO();
  if (!iso) {
    throw new Error("Unable to compute the next scheduled run.");
  }
  return iso;
}

function resolveMonthlyCandidate(
  base: DateTime,
  requestedDay: number
): DateTime {
  return base.set({
    day: Math.min(requestedDay, base.daysInMonth ?? 31),
  });
}

function parseTimeOfDay(timeOfDay: string): [number, number] {
  const match = timeOfDay.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("Time of day must use HH:MM (24-hour) format.");
  }
  const hourText = match[1];
  const minuteText = match[2];
  if (!hourText || !minuteText) {
    throw new Error("Time of day must use HH:MM (24-hour) format.");
  }
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  if (hour > 23 || minute > 59) {
    throw new Error("Time of day must be a valid 24-hour time.");
  }
  return [hour, minute];
}

function ensureTimeZone(timezone: string, from: DateTime): DateTime {
  const zoned = from.setZone(timezone);
  if (!zoned.isValid) {
    throw new Error(`Unsupported time zone: ${timezone}`);
  }
  return zoned;
}
