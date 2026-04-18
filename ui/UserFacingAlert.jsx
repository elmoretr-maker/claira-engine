import "./userFacingAlert.css";

/**
 * @typedef {import("./userFacingErrorMessage.js").UserFacingError} UserFacingError
 * @typedef {import("./userFacingErrorMessage.js").UserFacingErrorType} UserFacingErrorType
 */

/** @type {Record<UserFacingErrorType, string>} */
const TYPE_ICONS = {
  input: "\u2192",
  validation: "\u26A0",
  system: "\u26A1",
};

/**
 * @param {{
 *   value: string | UserFacingError | null | undefined,
 *   className?: string,
 *   hintClassName?: string,
 *   wrapClassName?: string,
 *   role?: "alert" | "status",
 *   showTypeIcon?: boolean,
 * }} props
 */
export function UserFacingAlert({
  value,
  className = "",
  hintClassName = "",
  wrapClassName,
  role = "alert",
  showTypeIcon = true,
}) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    return (
      <p className={className} role={role}>
        {value}
      </p>
    );
  }

  const baseClass = className.trim().split(/\s+/).filter(Boolean)[0] ?? "";
  const wrapCls = wrapClassName ?? (baseClass ? `${baseClass}-wrap` : "");
  const hintCls = hintClassName || (baseClass ? `${baseClass}-hint` : "");
  /** Degrade gracefully: default to system styling + icon when `type` is missing */
  const effectiveType = /** @type {UserFacingErrorType} */ (value.type ?? "system");
  const typeMod = `user-facing-alert--${effectiveType}`;
  const wrapClassCombined = [wrapCls, "user-facing-alert", typeMod].filter(Boolean).join(" ");
  const typeTitle = `Error type: ${effectiveType}`;
  const icon = showTypeIcon ? TYPE_ICONS[effectiveType] : null;

  return (
    <div className={wrapClassCombined || undefined} role={role}>
      {icon ? (
        <span className="user-facing-alert__icon" aria-hidden="true" title={typeTitle}>
          {icon}
        </span>
      ) : null}
      <div className="user-facing-alert__body">
        <p className={className}>{value.message}</p>
        {value.actionHint ? <p className={hintCls}>{value.actionHint}</p> : null}
      </div>
    </div>
  );
}
