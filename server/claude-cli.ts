import { spawn, ChildProcess, execSync } from "child_process";
import { StreamParser } from "./stream-parser";
import { EventEmitter } from "events";

interface RunOptions {
  message: string;
  sessionId?: string | null;
  model?: string;
  cwd: string;
}

/**
 * Claude CLI 프로세스 매니저.
 *
 * 이벤트:
 *   "data"  — 파싱된 stream-json 이벤트 객체
 *   "error" — 에러 메시지 (string)
 *   "exit"  — 프로세스 종료 (code: number | null)
 */
export class ClaudeCliManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private parser: StreamParser | null = null;
  private _busy = false;

  get busy(): boolean {
    return this._busy;
  }

  /**
   * Claude CLI를 실행한다.
   * 이미 실행 중이면 false를 반환한다.
   */
  run(options: RunOptions): boolean {
    if (this._busy) return false;

    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--dangerously-skip-permissions",
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    }

    this._busy = true;
    this.parser = new StreamParser();

    // Windows에서는 claude.cmd를 사용하므로 shell: true 필요
    // 메시지는 stdin으로 전달 (개행 등 특수문자 셸 이스케이프 문제 방지)
    this.process = spawn("claude", args, {
      cwd: options.cwd,
      shell: true,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // 메시지를 stdin으로 전달하고 닫기
    this.process.stdin?.write(options.message);
    this.process.stdin?.end();

    this.parser.on("data", (data: unknown) => {
      this.emit("data", data);
    });

    this.parser.on("error", (line: string) => {
      console.error("[StreamParser] 파싱 실패:", line.substring(0, 200));
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.parser?.feed(chunk.toString("utf-8"));
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString("utf-8");
      console.error("[claude stderr]", msg);
      if (msg.includes("Error") || msg.includes("error")) {
        this.emit("error", msg);
      }
    });

    this.process.on("close", (code) => {
      this.parser?.flush();
      this._busy = false;
      this.process = null;
      this.parser = null;
      this.emit("exit", code);
    });

    this.process.on("error", (err) => {
      this._busy = false;
      this.process = null;
      this.parser = null;
      this.emit("error", `CLI 실행 실패: ${err.message}`);
      this.emit("exit", 1);
    });

    return true;
  }

  /**
   * 실행 중인 프로세스를 중단한다.
   * Windows에서는 taskkill로 프로세스 트리 전체를 종료한다.
   */
  abort(): void {
    if (!this.process || !this._busy) return;

    const pid = this.process.pid;
    if (!pid) return;

    try {
      if (process.platform === "win32") {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
      } else {
        this.process.kill("SIGTERM");
      }
    } catch {
      // 이미 종료된 프로세스일 수 있음
    }
  }
}
