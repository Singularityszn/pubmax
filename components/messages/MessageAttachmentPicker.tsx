"use client";

import { BarChart3, CalendarDays, Camera, FileText, Images, MapPin, UserRound, X } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";

import {
  MESSAGE_ATTACH_CONTACT_SHORT,
  MESSAGE_ATTACH_EVENT_SHORT,
  MESSAGE_ATTACH_POLL_SHORT,
  MESSAGE_ATTACH_CONTACT_LABEL,
  MESSAGE_ATTACH_EVENT_LABEL,
  MESSAGE_ATTACH_POLL_LABEL,
  MESSAGE_ATTACH_VENUE_LABEL,
  MESSAGE_ATTACH_VENUE_SHORT,
} from "@/lib/messageAttachments";
import { PROFILE_IMAGE_PICKER_ACCEPT } from "@/lib/profileImagePicker";

import "@/components/mobile/mobileMapShell.css";

export type MessageAttachKind = "photos" | "camera" | "document";

/**
 * The kinds that are not a FILE. A file target clicks a hidden input; these
 * open a picker in the composer dock instead, so the sheet is one grid rather
 * than two families of control that look alike and behave differently.
 */
type MessageAttachmentKindTarget = "venue" | "contact" | "event" | "poll";

export type MessageAttachmentPickerHandle = {
  select: (kind: MessageAttachKind) => void;
};

type MessageAttachmentPickerProps = {
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onKindSelected: (kind: MessageAttachKind) => void;
  /**
   * Optional: when a host offers the non-file kinds, the sheet grows a row for
   * them. Absent, the sheet is exactly the three file targets it shipped with.
   */
  onAttachmentKind?: (kind: MessageAttachmentKindTarget) => void;
};

type Target = {
  kind: MessageAttachKind;
  label: string;
  Icon: typeof Images;
};

type AttachmentTarget = {
  kind: MessageAttachmentKindTarget;
  label: string;
  Icon: typeof Images;
};

const TARGETS: readonly Target[] = [
  {
    kind: "photos",
    label: "Photos",
    Icon: Images,
  },
  {
    kind: "camera",
    label: "Camera",
    Icon: Camera,
  },
  {
    kind: "document",
    label: "Document",
    Icon: FileText,
  },
];

const ATTACHMENT_TARGET_ARIA: Record<MessageAttachmentKindTarget, string> = {
  venue: MESSAGE_ATTACH_VENUE_LABEL,
  contact: MESSAGE_ATTACH_CONTACT_LABEL,
  event: MESSAGE_ATTACH_EVENT_LABEL,
  poll: MESSAGE_ATTACH_POLL_LABEL,
};

const ATTACHMENT_TARGETS: readonly AttachmentTarget[] = [
  { kind: "venue", label: MESSAGE_ATTACH_VENUE_SHORT, Icon: MapPin },
  { kind: "contact", label: MESSAGE_ATTACH_CONTACT_SHORT, Icon: UserRound },
  { kind: "event", label: MESSAGE_ATTACH_EVENT_SHORT, Icon: CalendarDays },
  { kind: "poll", label: MESSAGE_ATTACH_POLL_SHORT, Icon: BarChart3 },
];

const SWIPE_DISMISS_PX = 80;

const MessageAttachmentPicker = forwardRef<
  MessageAttachmentPickerHandle,
  MessageAttachmentPickerProps
>(function MessageAttachmentPicker(
  { open, disabled, onOpenChange, onFileChange, onKindSelected, onAttachmentKind },
  ref,
) {
  const titleId = useId();
  const inputRefs = useRef<Partial<Record<MessageAttachKind, HTMLInputElement | null>>>({});
  const dragStartY = useRef<number | null>(null);
  const dragOffsetYRef = useRef(0);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const close = useCallback(() => {
    dragStartY.current = null;
    dragOffsetYRef.current = 0;
    setDragOffsetY(0);
    setDragging(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const select = useCallback(
    (kind: MessageAttachKind) => {
      if (disabled) return;
      const input = inputRefs.current[kind];
      if (!input) return;
      onKindSelected(kind);
      close();
      input.click();
    },
    [close, disabled, onKindSelected],
  );

  useImperativeHandle(ref, () => ({ select }), [select]);

  const onDragStart = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragStartY.current = event.clientY;
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable for synthetic events and older browsers.
    }
  }, []);

  const onDragMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (dragStartY.current === null) return;
    const offset = Math.max(0, event.clientY - dragStartY.current);
    dragOffsetYRef.current = offset;
    setDragOffsetY(offset);
  }, []);

  const onDragEnd = useCallback(() => {
    const offset = dragOffsetYRef.current;
    dragStartY.current = null;
    dragOffsetYRef.current = 0;
    setDragging(false);
    if (offset >= SWIPE_DISMISS_PX) {
      close();
      return;
    }
    setDragOffsetY(0);
  }, [close]);

  return (
    <>
      <input
        ref={(element) => {
          inputRefs.current.photos = element;
        }}
        id="message-photo-file"
        type="file"
        accept={PROFILE_IMAGE_PICKER_ACCEPT}
        className="composerFileInput"
        aria-label="Choose a photo from your library"
        onChange={onFileChange}
      />
      <input
        ref={(element) => {
          inputRefs.current.camera = element;
        }}
        id="message-camera-file"
        type="file"
        accept={PROFILE_IMAGE_PICKER_ACCEPT}
        capture="environment"
        className="composerFileInput"
        aria-label="Take a photo with the camera"
        onChange={onFileChange}
      />
      <input
        ref={(element) => {
          inputRefs.current.document = element;
        }}
        id="message-document-file"
        type="file"
        accept={PROFILE_IMAGE_PICKER_ACCEPT}
        className="composerFileInput"
        aria-label="Choose a photo file"
        onChange={onFileChange}
      />

      {open ? (
        <div className="mobileSheetPortal messageAttachSheetPortal">
          <button
            className="mobileSheetScrim"
            type="button"
            tabIndex={-1}
            onClick={close}
            aria-label="Dismiss attachment chooser"
          />
          <section
            className="mapDrawer mobileSharedSheet contextual open sheet-half messageAttachSheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            style={{
              transform: `translateY(${dragOffsetY}px)`,
              transition: dragging ? "none" : undefined,
            }}
          >
            <header
              className="mobileSharedSheetHeader sheetDragHandle messageAttachSheetHeader"
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            >
              <span className="mobileSharedSheetGrab" aria-hidden="true" />
              <h2 id={titleId}>Add to message</h2>
              <button
                type="button"
                className="messageAttachSheetClose"
                aria-label="Close attachment chooser"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={close}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <div className="mobileSharedSheetBody messageAttachSheetBody">
              <div className="messageAttachGrid">
                {TARGETS.map(({ kind, label, Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    className="messageAttachTarget"
                    disabled={disabled}
                    onClick={() => select(kind)}
                  >
                    <span className="messageAttachIcon" aria-hidden="true">
                      <Icon size={30} strokeWidth={2.2} />
                    </span>
                    <span className="messageAttachLabel">{label}</span>
                  </button>
                ))}
                {onAttachmentKind
                  ? ATTACHMENT_TARGETS.map(({ kind, label, Icon }) => (
                      <button
                        key={kind}
                        type="button"
                        className="messageAttachTarget"
                        disabled={disabled}
                        aria-label={ATTACHMENT_TARGET_ARIA[kind]}
                        onClick={() => {
                          if (disabled) return;
                          close();
                          onAttachmentKind(kind);
                        }}
                      >
                        <span className="messageAttachIcon" aria-hidden="true">
                          <Icon size={30} strokeWidth={2.2} />
                        </span>
                        <span className="messageAttachLabel">{label}</span>
                      </button>
                    ))
                  : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
});

export default MessageAttachmentPicker;
