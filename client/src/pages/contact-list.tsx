import { User } from "lucide-react";

import { ContactSidebar } from "@/components/contact-sidebar";

export default function ContactList() {
  return (
    <>
      <div className="border-border w-full flex-1 border-r md:w-55 md:flex-none">
        <ContactSidebar />
      </div>
      <div className="text-muted-foreground/50 hidden flex-1 flex-col items-center justify-center md:flex">
        <User size={64} strokeWidth={1.5} className="mb-4" />
        <p className="text-muted-foreground/70">
          Select a contact to start chatting
        </p>
      </div>
    </>
  );
}
