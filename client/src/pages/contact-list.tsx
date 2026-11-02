import { User } from "lucide-react";

import { ContactSidebar } from "@/components/contact-sidebar";

export default function ContactList() {
  return (
    <>
      <div className="border-border bg-card min-h-0 w-full min-w-0 flex-1 overflow-hidden md:w-64 md:flex-none md:border-r lg:w-80">
        <ContactSidebar />
      </div>
      <div className="text-muted-foreground/50 hidden flex-1 flex-col items-center justify-center md:flex">
        <span className="bg-primary/8 text-primary-ink/60 mb-5 flex size-24 items-center justify-center rounded-3xl">
          <User size={40} strokeWidth={1.5} />
        </span>
        <h1 className="text-foreground mb-2 text-xl font-semibold">
          Keep in touch
        </h1>
        <p className="text-muted-foreground/70">
          Select a contact to start chatting
        </p>
      </div>
    </>
  );
}
