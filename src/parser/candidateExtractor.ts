export interface CandidateSegment {
  text: string;
  startLine: number;
}

const URL_ONLY_LINE = /^\s*https?:\/\/\S+\s*$/i;
const HOTEL_HEADER_LINE = /^\s*\d+\*\s*отели(?:\s|$)/i;
const MONTH_OR_YEAR_LINE = /\b(?:19|20)\d{2}\b|\b(?:январ[ьяе]|феврал[ьяе]|март[ае]?|апрел[ьяе]|ма[йяе]|июн[ьяе]|июл[ьяе]|август[ае]?|сентябр[ьяе]|октябр[ьяе]|ноябр[ьяе]|декабр[ьяе])\b/i;
const DESTINATION_TITLE_LINE = /^\s*[A-ZА-ЯЁ0-9][^.,!?;:]{0,60}\s*$/;
const LEADING_TRAVEL_ACTION_LINE = /^\s*(?:вылет|заезд|тур|перелет|перелёт|прилет|прилёт|выезд)(?:\s|$)/i;

const isCandidateHeaderLine = (line: string): boolean => {
  const trimmed = line.trim();

  if (!trimmed || URL_ONLY_LINE.test(trimmed)) {
    return false;
  }

  if (HOTEL_HEADER_LINE.test(trimmed)) {
    return true;
  }

  return (
    DESTINATION_TITLE_LINE.test(trimmed) &&
    MONTH_OR_YEAR_LINE.test(trimmed) &&
    !LEADING_TRAVEL_ACTION_LINE.test(trimmed)
  );
};

export const extractCandidates = (text: string): CandidateSegment[] => {
  const lines = text.split(/\r?\n/);
  const candidates: CandidateSegment[] = [];
  let currentLines: string[] | null = null;
  let currentStartLine: number | null = null;
  let leadingLines: string[] = [];
  let leadingStartLine: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      if (currentLines !== null) {
        currentLines.push('');
      } else if (leadingStartLine !== null) {
        leadingLines.push('');
      }
      continue;
    }

    if (URL_ONLY_LINE.test(trimmed)) {
      if (currentLines !== null) {
        currentLines.push(line);
      }
      continue;
    }

    if (currentLines === null) {
      if (isCandidateHeaderLine(trimmed)) {
        currentStartLine = leadingStartLine ?? index + 1;
        currentLines = leadingLines.length ? [...leadingLines, line] : [line];
      } else {
        if (leadingStartLine === null) {
          leadingStartLine = index + 1;
        }
        leadingLines.push(line);
      }
      continue;
    }

    if (isCandidateHeaderLine(trimmed)) {
      candidates.push({
        text: currentLines.join('\n').trimEnd(),
        startLine: currentStartLine ?? index + 1,
      });
      currentLines = [line];
      currentStartLine = index + 1;
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines !== null) {
    candidates.push({
      text: currentLines.join('\n').trimEnd(),
      startLine: currentStartLine ?? 1,
    });
  }

  return candidates;
};
