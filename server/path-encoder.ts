import path from "path";
import fs from "fs";

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

/**
 * 인코딩된 디렉토리명을 실제 파일시스템 경로로 역변환한다.
 * 하이픈이 경로 구분자인지 원래 하이픈인지 모호하므로,
 * 파일시스템을 탐색하며 존재하는 경로를 찾는다.
 */
export function decodePath(encoded: string): string | null {
  // Windows: "C--Users-kim-Desktop" → drive=C, rest="Users-kim-Desktop"
  const driveMatch = encoded.match(/^([A-Za-z])--(.+)$/);
  if (!driveMatch) return null;

  const driveLetter = driveMatch[1];
  const parts = driveMatch[2].split("-");

  function resolve(basePath: string, startIdx: number): string | null {
    if (startIdx >= parts.length) return basePath;

    let accumulated = parts[startIdx];
    for (let i = startIdx; i < parts.length; i++) {
      if (i > startIdx) accumulated += "-" + parts[i];
      const testPath = path.join(basePath, accumulated);
      try {
        if (fs.existsSync(testPath) && fs.statSync(testPath).isDirectory()) {
          const result = resolve(testPath, i + 1);
          if (result !== null) return result;
        }
      } catch {
        // 접근 불가 디렉토리 무시
      }
    }
    return null;
  }

  return resolve(`${driveLetter}:\\`, 0);
}

/**
 * ~/.claude/projects/ 내 모든 프로젝트 디렉토리를 스캔하여
 * 디코딩된 경로와 세션 수를 반환한다.
 */
export function listProjects(): { encoded: string; path: string; name: string; sessionCount: number }[] {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const projectsDir = path.join(homeDir, ".claude", "projects");

  if (!fs.existsSync(projectsDir)) return [];

  const dirs = fs.readdirSync(projectsDir).filter((d) => {
    try {
      return fs.statSync(path.join(projectsDir, d)).isDirectory();
    } catch {
      return false;
    }
  });

  const results: { encoded: string; path: string; name: string; sessionCount: number }[] = [];

  for (const dir of dirs) {
    const decoded = decodePath(dir);
    if (!decoded) continue;

    const sessionFiles = fs.readdirSync(path.join(projectsDir, dir))
      .filter((f) => f.endsWith(".jsonl"));

    const name = path.basename(decoded);

    results.push({
      encoded: dir,
      path: decoded,
      name,
      sessionCount: sessionFiles.length,
    });
  }

  // 이름순 정렬
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}
