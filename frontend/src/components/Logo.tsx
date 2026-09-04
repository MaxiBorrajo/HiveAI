interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

export function Logo({ size = 32, withWordmark = false, className }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <img src="/logo.png" alt="HiveAI Logo" width={size} height={size} className="object-contain" />
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

