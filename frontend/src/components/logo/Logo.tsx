interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

export function Logo({ size = 32, withWordmark = false, className }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 68 64"
        fill="none"
        role="img"
        aria-label="HiveAI"
      >
        <path
          d="M52.8 20 L32 8 L11.2 20 L11.2 44 L32 56 L52.8 44"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-foreground"
        />
        <circle cx="61" cy="32" r="4" className="fill-primary" />
      </svg>
      {withWordmark && (
        <span
          className="text-display text-lg"
          style={{ fontStretch: "118%" }}
        >
          Hive<span className="text-primary">AI</span>
        </span>
      )}
    </div>
  );
}