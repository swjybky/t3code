import { SparklesIcon } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { SidebarMenuButton, SidebarMenuItem } from "../../components/ui/sidebar";
import { SKILLS_MANAGER_LABEL, SKILLS_MANAGER_PATH } from "./labels";

export function SkillsManagerNavItem({
  pathname,
  compactSearchOpen,
}: {
  readonly pathname: string;
  readonly compactSearchOpen: boolean;
}) {
  const navigate = useNavigate();
  const searchStr = useLocation({ select: (location) => location.searchStr });
  const active = pathname === SKILLS_MANAGER_PATH || pathname.startsWith(`${SKILLS_MANAGER_PATH}/`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={() => {
          void navigate({
            href: `${SKILLS_MANAGER_PATH}${searchStr}`,
            replace: true,
          });
        }}
      >
        <SparklesIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <span className={cn("truncate", !compactSearchOpen && "max-md:sr-only")}>
          {SKILLS_MANAGER_LABEL}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
