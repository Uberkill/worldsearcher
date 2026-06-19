import { useStore } from '../../stores/useStore';
import { CursorItem } from './CursorItem';
import { X } from 'lucide-react';

export const BaseOverlay = ({ active, onClose, title, children, containerClassName = "flex flex-col items-center justify-center" }) => {
  if (!active) return null;

  return (
    <div
      className={`fixed inset-0 bg-black/60 z-50 ${containerClassName} backdrop-blur-sm pointer-events-auto select-none`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.stopPropagation();
        const state = useStore.getState();
        if (state.heldItem) {
          state.executeLocalTransaction(
            state.heldItem.sourceLoc,
            null,
            'DROP',
            state.heldItem.count
          );
          state.setHeldItem(null);
        } else {
          onClose();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <CursorItem />

      {title ? (
        <div className="bg-neutral-900 border-4 border-neutral-700 p-6 rounded-lg shadow-2xl relative max-w-2xl w-full max-h-[85dvh] overflow-y-auto">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={24} />
          </button>

          <h2
            className="text-2xl font-bold text-white mb-6 font-mono"
            style={{ textShadow: '2px 2px 0 #000' }}
          >
            {title}
          </h2>

          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
};
