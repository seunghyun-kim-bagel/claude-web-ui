import path from "path";

/**
 * 프로젝트 디렉토리 경로를 Claude CLI 세션 디렉토리명으로 인코딩
 * 예: "C:\Users\kim\Desktop" → "C--Users-kim-Desktop"
 * 규칙: 경로 구분자(\, /, :)를 "-"로 치환
 */
export function encodePath(dirPath: string): string {
  const normalized = path.resolve(dirPath);
  return normalized.replace(/[\\/: ]/g, "-");
}

/**
 * Claude CLI 세션 저장 디렉토리의 전체 경로를 반환
 */
export function getSessionDir(projectDir: string): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const encoded = encodePath(projectDir);
  return path.join(homeDir, ".claude", "projects", encoded);
}
