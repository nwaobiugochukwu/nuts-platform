import { create } from "zustand";

interface ProfileDialogState {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

export const useProfileDialogStore = create<ProfileDialogState>((set) => ({
  isOpen: false,
  setOpen: (open) => set({ isOpen: open }),
}));

interface OrderDialogState {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

export const useOrderDialogStore = create<OrderDialogState>((set) => ({
  isOpen: false,
  setOpen: (open) => set({ isOpen: open }),
}));
