import { create } from 'zustand';


export const useUIStore = create((set, get) => ({
  activeModal: null,
  modalData: null,

  openModal: (modalId, data = null) => set(() => {
    // Singular focus: opening a modal closes any currently open one.
    return {
      activeModal: modalId,
      modalData: data
    };
  }),

  closeModal: () => set(() => {
    return { activeModal: null, modalData: null };
  }),

  toggleModal: (modalId, data = null) => set((state) => {
    if (state.activeModal === modalId) {
      return { activeModal: null, modalData: null };
    } else {
      return {
        activeModal: modalId,
        modalData: data
      };
    }
  }),

  isModalOpen: (modalId) => get().activeModal === modalId,
  
  getAnyUIOpen: () => get().activeModal !== null,
}));

// Side-effect: Ensure PointerLock is released whenever a UI overlay opens.
useUIStore.subscribe((state) => {
  if (state.activeModal !== null && document.pointerLockElement) {
    document.exitPointerLock();
  }
});
