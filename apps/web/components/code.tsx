import type { Token } from "@/lib/highlight";

export function Tokens({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((token, index) =>
        token.className ? (
          <span className={token.className} key={index}>
            {token.text}
          </span>
        ) : (
          token.text
        ),
      )}
    </>
  );
}
