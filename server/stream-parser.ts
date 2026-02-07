import { EventEmitter } from "events";

/**
 * NDJSON (Newline-Delimited JSON) 스트림 파서.
 * stdout 데이터를 줄바꿈 기준으로 버퍼링한 뒤 JSON.parse한다.
 *
 * 이벤트:
 *   "data"  — 파싱된 JSON 객체
 *   "error" — 파싱 실패한 라인 (스킵하고 계속 진행)
 */
export class StreamParser extends EventEmitter {
  private buffer = "";

  /**
   * stdout의 data 청크를 받아서 처리한다.
   * 줄바꿈(\n)을 기준으로 분리하고, 완성된 라인만 파싱한다.
   * 마지막 줄이 불완전하면 다음 청크에서 이어서 처리된다.
   */
  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // 마지막 요소는 아직 불완전할 수 있으므로 버퍼에 보관
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        this.emit("data", parsed);
      } catch {
        this.emit("error", trimmed);
      }
    }
  }

  /**
   * 스트림 종료 시 버퍼에 남은 데이터를 처리한다.
   */
  flush(): void {
    const trimmed = this.buffer.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        this.emit("data", parsed);
      } catch {
        this.emit("error", trimmed);
      }
    }
    this.buffer = "";
  }
}
