import { User } from "lucide-react";

import { ContactSidebar } from "@/components/contact-sidebar";

export default function ContactList() {
  return (
    <>
      <div className="border-border w-55 shrink-0 border-r">
        <ContactSidebar />
      </div>
      <div className="text-muted-foreground/50 flex flex-1 flex-col items-center justify-center">
        <User size={64} strokeWidth={1.5} className="mb-4" />
        <p className="text-muted-foreground/70">
          Select a contact to start chatting
        </p>
      </div>
    </>
  );
}
