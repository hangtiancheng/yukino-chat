const INSECURE_CONTEXT_MESSAGE =
  "Calls require a secure connection (HTTPS). Open this site over HTTPS to use your microphone and camera.";
const UNSUPPORTED_MESSAGE =
  "Microphone and camera access is not available in this browser or page context.";
const PERMISSION_MESSAGE =
  "Microphone or camera permission was denied. Allow access in your browser settings and try again.";
const NOT_FOUND_MESSAGE = "No microphone or camera was found on this device.";
const BUSY_MESSAGE =
  "Your microphone or camera is busy or unavailable. Close other apps using it and try again.";
const SECURITY_MESSAGE =
  "Your browser blocked microphone or camera access on this page. Check the site permissions and try again.";
const GENERIC_MESSAGE =
  "Could not access your microphone or camera. Please try again.";

function errorName(error: unknown): string {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return "";
  }
  return typeof error.name === "string" ? error.name : "";
}

export function mediaErrorMessage(error?: unknown): string {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return INSECURE_CONTEXT_MESSAGE;
  }
  if (
    typeof navigator === "undefined" ||
    typeof navigator.mediaDevices?.getUserMedia !== "function"
  ) {
    return UNSUPPORTED_MESSAGE;
  }
  switch (errorName(error)) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return PERMISSION_MESSAGE;
    case "NotFoundError":
    case "DevicesNotFoundError":
      return NOT_FOUND_MESSAGE;
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "Your microphone or camera does not support the requested settings.";
    case "NotReadableError":
    case "TrackStartError":
      return BUSY_MESSAGE;
    case "SecurityError":
      return SECURITY_MESSAGE;
    case "NotSupportedError":
      return UNSUPPORTED_MESSAGE;
    default:
      return GENERIC_MESSAGE;
  }
}
