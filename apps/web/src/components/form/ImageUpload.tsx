"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { adminApi, vendorApi } from "@/api/core/client";
import { Label } from "@/component/ui/label";
import { cn } from "@/lib/util";
import {
AlertCircle,
ChevronLeft,
ChevronRight,
Loader2,
Star,
UploadCloud,
X
} from "lucide-react";
import { useCallback,useRef,useState } from "react";
import { useFormContext } from "react-hook-form";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingFile {
  /** Unique id for React key and cancel tracking */
  id: string;
  file: File;
  /** Object URL for thumbnail preview — revoked on remove */
  preview: string;
}

interface UploadedImage {
  url: string;
  publicId: string;
}

interface ImageUploadProps {
  /**
   * RHF field name.  The component sets an **array** of URL strings into this
   * field (`string[]`).  Make sure your Zod schema uses `z.array(z.string())`.
   */
  name: string;
  label?: string;
  className?: string;
  /** Aspect ratio hint shown in the drop zone, e.g. "square", "16:9" */
  aspectHint?: string;
  /** Max images allowed — server hard-caps at 6 */
  maxImages?: number;
  single?: boolean;
  authRole: "admin" | "vendor";
}

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/svg+xml"];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Multi-image drag-and-drop uploader.
 *
 * - Accepts up to `maxImages` (default 6) files at once.
 * - Shows a thumbnail queue with per-file cancel *before* uploading.
 * - Uploads all pending files via `POST /images/upload-multiple`.
 * - Writes an array of URL strings into the RHF field (`name`).
 * - Uploaded images can also be individually removed from the result list.
 *
 * Usage (inside a <FormProvider>):
 *   <ImageUpload name="imageUrls" label="Product Images (up to 6)" />
 */
export function ImageUpload({
  name,
  label = "Images",
  className,
  aspectHint,
  maxImages = 6,
  single = false,
  authRole,
}: ImageUploadProps) {
  const api = authRole === "admin" ? adminApi : vendorApi;
  const { setValue, watch } = useFormContext();
  const fieldValue = watch(name);
  const uploadedUrls: string[] = Array.isArray(fieldValue)
    ? fieldValue
    : typeof fieldValue === "string" && fieldValue
      ? [fieldValue]
      : [];

  const [pending, setPending] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalCount = uploadedUrls.length + pending.length;
  const remaining = maxImages - totalCount;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function validateFile(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) return "Only JPEG, PNG, WebP, or SVG images are allowed.";
    if (file.size > MAX_SIZE_BYTES) return "Each file must be smaller than 5 MB.";
    return null;
  }

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setError(null);
      const arr = Array.from(files);

      if (arr.length > remaining) {
        setError(`You can only add ${remaining} more image${remaining === 1 ? "" : "s"} (max ${maxImages}).`);
        return;
      }

      const newPending: PendingFile[] = [];
      for (const file of arr) {
        const validationError = validateFile(file);
        if (validationError) {
          setError(validationError);
          return;
        }
        newPending.push({
          id: `${file.name}-${file.lastModified}-${Math.random()}`,
          file,
          preview: URL.createObjectURL(file),
        });
      }
      setPending((prev) => [...prev, ...newPending]);
    },
     
    [remaining, maxImages]
  );

  /** Remove a pending (not-yet-uploaded) file from the queue */
  function cancelPending(id: string) {
    setPending((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((p) => p.id !== id);
    });
  }

  /** Remove an already-uploaded URL from the result list */
  function removeUploaded(url: string) {
    setValue(
      name,
      single ? "" : uploadedUrls.filter((u) => u !== url),
      { shouldValidate: true, shouldDirty: true }
    );
  }

  function moveImage(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= uploadedUrls.length) return;
    const next = [...uploadedUrls];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    setValue(name, single ? next[0] ?? "" : next, { shouldDirty: true, shouldValidate: true });
  }

  function setAsCover(index: number) {
    if (index === 0) return;
    moveImage(index, 0);
  }

  /** Upload all pending files via the multi-upload endpoint */
  async function uploadAll() {
    if (pending.length === 0) return;
    setError(null);
    setUploading(true);

    try {
      const form = new FormData();
      for (const { file } of pending) {
        form.append("files", file);
      }

      const { data } = await api.post<UploadedImage[]>(
        "/images/upload",
        form
      );

      const rawResults = Array.isArray(data) ? data : [];
      const newUrls = rawResults.map((image) => image.url).filter(Boolean);

      // Revoke previews to free memory
      for (const { preview } of pending) {
        URL.revokeObjectURL(preview);
      }
      setPending([]);

      setValue(name, single ? (newUrls[0] ?? "") : [...uploadedUrls, ...newUrls], {
        shouldValidate: true,
        shouldDirty: true,
      });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Upload failed. Please try again.";
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setUploading(false);
    }
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = ""; // allow re-selecting same file
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={cn("space-y-3", className)}>
      {label && (
        <div className="flex items-center justify-between">
          <Label htmlFor={`img-upload-${name}`}>{label}</Label>
          {uploadedUrls.length > 1 && (
            <span className="text-[11px] font-medium text-muted-foreground">
              Tip: The first image is the cover photo
            </span>
          )}
        </div>
      )}

      {/* ── Uploaded result thumbnails with swapping/reordering ── */}
      {uploadedUrls.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2.5">
            {uploadedUrls.map((url, index) => {
              const isFirst = index === 0;
              const isLast = index === uploadedUrls.length - 1;
              return (
                <div
                  key={url}
                  className={cn(
                    "relative h-24 w-24 overflow-hidden rounded-2xl border bg-muted/30 group shadow-2xs transition-all",
                    isFirst
                      ? "ring-2 ring-primary border-primary"
                      : "border-border/70 hover:border-border"
                  )}
                >
                  
                  <RemoteImage src={url} alt={`Product ${index + 1}`} className="h-full w-full object-cover" />

                  {/* Cover badge on first image (multi-mode only) */}
                  {isFirst && !single && (
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground text-[9px] font-bold shadow-xs flex items-center gap-0.5 z-10">
                      <Star className="h-2.5 w-2.5 fill-current" /> Cover
                    </span>
                  )}

                  {/* Dark overlay on hover with actions */}
                  <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-1.5 z-20">
                    {/* Top row: Set Cover button (if not first and multi-mode) & Delete */}
                    <div className="flex items-center justify-between w-full">
                      {!isFirst && !single ? (
                        <button
                          type="button"
                          onClick={() => setAsCover(index)}
                          className="h-6 w-6 rounded-lg bg-black/70 text-amber-300 hover:bg-black/90 hover:scale-110 flex items-center justify-center transition-all"
                          title="Set as cover image"
                        >
                          <Star className="h-3 w-3" />
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        onClick={() => removeUploaded(url)}
                        className="h-6 w-6 rounded-lg bg-black/70 text-white hover:bg-destructive hover:scale-110 flex items-center justify-center transition-all"
                        aria-label="Remove image"
                        title="Remove image"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Bottom row: Swap Left & Swap Right arrows */}
                    {uploadedUrls.length > 1 && (
                      <div className="flex items-center justify-center gap-1 w-full">
                        <button
                          type="button"
                          disabled={isFirst}
                          onClick={() => moveImage(index, index - 1)}
                          className="h-5 w-5 rounded-md bg-black/80 text-white disabled:opacity-20 hover:bg-primary flex items-center justify-center transition-all"
                          title="Move left"
                        >
                          <ChevronLeft className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          disabled={isLast}
                          onClick={() => moveImage(index, index + 1)}
                          className="h-5 w-5 rounded-md bg-black/80 text-white disabled:opacity-20 hover:bg-primary flex items-center justify-center transition-all"
                          title="Move right"
                        >
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Pending queue (not yet uploaded) ── */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Ready to upload ({pending.length} file{pending.length > 1 ? "s" : ""})
          </p>
          <div className="flex flex-wrap gap-2">
            {pending.map(({ id, preview, file }) => (
              <div
                key={id}
                className="relative h-20 w-20 overflow-hidden rounded-xl border border-dashed border-primary/50 bg-muted/30 group"
              >
                
                <RemoteImage src={preview} alt={file.name} className="h-full w-full object-cover opacity-70" />
                {/* Cancel button — removes from queue BEFORE upload */}
                <button
                  type="button"
                  onClick={() => cancelPending(id)}
                  disabled={uploading}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm hover:bg-destructive hover:text-white transition-colors disabled:pointer-events-none"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
                <span className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5 text-xs text-white truncate">
                  {file.name}
                </span>
              </div>
            ))}
          </div>

          {/* Upload button */}
          <button
            type="button"
            onClick={uploadAll}
            disabled={uploading}
            className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <UploadCloud className="h-3.5 w-3.5" />
                Upload {pending.length} image{pending.length > 1 ? "s" : ""}
              </>
            )}
          </button>
        </div>
      )}

      {/* ── Drop zone (only shown when more images can be added) ── */}
      {remaining > 0 && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex h-36 w-full cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed transition-all duration-200 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            dragging
              ? "border-primary bg-primary/5 scale-[0.99]"
              : "border-border/60 bg-muted/20 hover:border-primary/50 hover:bg-primary/5",
            uploading && "pointer-events-none opacity-60",
          )}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UploadCloud className="h-5 w-5" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              Click to select or drag &amp; drop
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              JPEG, PNG, WebP · max 5 MB each · up to {remaining} more
              {aspectHint && ` · ${aspectHint}`}
            </p>
          </div>
        </div>
      )}

      {remaining === 0 && pending.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Maximum of {maxImages} images reached.
        </p>
      )}

      {/* Hidden file input — single or multiple allowed */}
      <input
        ref={inputRef}
        id={`img-upload-${name}`}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/svg+xml"
        multiple={!single}
        className="hidden"
        onChange={onInputChange}
      />

      {/* Error display */}
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
