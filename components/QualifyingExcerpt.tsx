type QualifyingExcerptProps = {
  text: string;
  excerptClassName: string;
  qualifierClassName: string;
};

const QUALIFIER_CUE =
  /\b(?:although|apparently|believed|but|cannot|claimed|could|current|currently|dated|does not|however|may|might|not established|present|present-day|probably|recorded|reportedly|reputed|said|subject to|today|uncertain|unknown|unless|until|while)\b/i;

function splitQualifyingExcerpt(text: string): {
  excerpt: string | null;
  qualifier: string | null;
} {
  const value = text.trim();
  const cue = QUALIFIER_CUE.exec(value);
  if (!cue || cue.index === 0) {
    return { excerpt: cue ? null : value, qualifier: cue ? value : null };
  }

  const prefix = value.slice(0, cue.index);
  const boundaries = Array.from(prefix.matchAll(/[,;.!?]\s+/g));
  const boundary = boundaries.at(-1);
  const splitAt = boundary
    ? boundary.index + boundary[0].length
    : cue.index;

  if (splitAt < 24) {
    return { excerpt: null, qualifier: value };
  }

  return {
    excerpt: value.slice(0, splitAt).trim(),
    qualifier: value.slice(splitAt).trim(),
  };
}

export default function QualifyingExcerpt({
  text,
  excerptClassName,
  qualifierClassName,
}: QualifyingExcerptProps) {
  const { excerpt, qualifier } = splitQualifyingExcerpt(text);

  return (
    <>
      {excerpt ? <span className={excerptClassName}>{excerpt}</span> : null}
      {qualifier ? (
        <span className={qualifierClassName}> {qualifier}</span>
      ) : null}
    </>
  );
}
