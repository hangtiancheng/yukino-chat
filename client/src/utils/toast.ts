import { toast } from "sonner";

type ToastType = "info" | "success" | "warning" | "error";

export function showToast(message: string, type: ToastType = "info") {
  switch (type) {
    case "success":
      toast.success(message);
      break;
    case "error":
      toast.error(message);
      break;
    case "warning":
      toast.warning(message);
      break;
    default:
      toast.info(message);
      break;
  }
}
