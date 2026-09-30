interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

export function Logo({
  size = 32,
  withWordmark = false,
  className,
}: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <svg
        role="img"
        aria-label="HiveAI Logo"
        width={size}
        height={size}
        viewBox="0 0 1024 1024"
        className="object-contain shrink-0 text-foreground"
      >
        <path
          d="M510 36 L99 274 L99 749 L513 987 L924 749 L924 434 L838 483 L838 700 L513 888 L186 701 L186 322 L510 135 L700 243 L785 194 Z"
          fill="currentColor"
        />
        <path
          d="M844 192 L734 256 L734 383 L846 446 L954 383 L954 256 Z"
          className="fill-primary"
        />
      </svg>
      {withWordmark && (
        <span className="text-display text-lg" style={{ fontStretch: "118%" }}>
          Hive<span className="text-primary">AI</span>
        </span>
      )}
    </div>
  );
}
