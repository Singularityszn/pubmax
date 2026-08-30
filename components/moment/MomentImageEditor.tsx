"use client";

import ImageEditor from "@unlayer/react-image-editor";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";

type MomentImageEditorProps = {
  image: string;
  onSave: (result: { blob: Blob }) => void;
  onCancel: () => void;
  onError: () => void;
};

export default function MomentImageEditor({
  image,
  onSave,
  onCancel,
  onError,
}: MomentImageEditorProps): React.JSX.Element {
  const sheetRef = useRef<HTMLElement | null>(null);

  useFocusTrap(true, sheetRef);
  useDismissOnEscape(true, onCancel);
  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="momentEditorBackdrop">
      <section
        className="momentEditorSheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="moment-editor-title"
        ref={sheetRef}
        tabIndex={-1}
      >
        <header className="momentEditorHeader">
          <h2 id="moment-editor-title">Edit photo</h2>
          <button type="button" className="momentEditorClose" onClick={onCancel} aria-label="Close editor">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="momentEditorCanvas">
          <ImageEditor
            image={image}
            options={{
              theme: "light",
              offline: true,
              aiAssistantOpenState: "closed",
              features: { ai: false },
            }}
            minHeight="min(500px, calc(100svh - 170px))"
            style={{ width: "100%", minHeight: "min(500px, calc(100svh - 170px))" }}
            onSave={onSave}
            onCancel={onCancel}
            onLoadError={onError}
            onError={onError}
          />
        </div>
      </section>
    </div>
  );
}
