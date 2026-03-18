"use client";

import { useCallback, useRef } from "react";
import { useClickOutside } from "@/app/(board)/_hooks/useClickOutside";

type UseCardModalMemberPickerArgs = {
  setShowMemberDropdown: React.Dispatch<React.SetStateAction<boolean>>;
  setMemberSearch: React.Dispatch<React.SetStateAction<string>>;
};

export function useCardModalMemberPicker({
  setShowMemberDropdown,
  setMemberSearch,
}: UseCardModalMemberPickerArgs) {
  const memberButtonRef = useRef<HTMLButtonElement | null>(null);
  const memberDropdownRef = useRef<HTMLDivElement | null>(null);

  const closeMemberDropdown = useCallback(() => {
    setShowMemberDropdown(false);
    setMemberSearch("");
  }, [setMemberSearch, setShowMemberDropdown]);

  const toggleMemberDropdown = useCallback(() => {
    setShowMemberDropdown((prev) => !prev);
  }, [setShowMemberDropdown]);

  useClickOutside(memberDropdownRef, closeMemberDropdown);

  return {
    memberButtonRef,
    memberDropdownRef,
    closeMemberDropdown,
    toggleMemberDropdown,
  };
}
