"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { adminApi, vendorApi } from "@/api/core/client";
import { Button } from "@/component/ui/button";
import { Input } from "@/component/ui/input";
import { Label } from "@/component/ui/label";
import { cn } from "@/lib/util";
import {
ImageIcon,
Layers,
Loader2,
Plus,
Trash2,
UploadCloud,
X
} from "lucide-react";
import { useRef,useState } from "react";
import { toast } from "sonner";

export interface VariantOptionItem {
  name: string;
  value: string;
}

export interface ProductVariantItem {
  id?: string;
  options: VariantOptionItem[];
  stock: number;
  images: string[];
}

interface ProductVariantBuilderProps {
  authRole: "admin" | "vendor";
  variants: ProductVariantItem[];
  onChange: (variants: ProductVariantItem[]) => void;
  className?: string;
}

const COMMON_ATTRIBUTES = ["Size", "Color", "Material", "Style", "Flavour", "Weight"];

export function ProductVariantBuilder({
  authRole,
  variants,
  onChange,
  className,
}: ProductVariantBuilderProps) {
  const api = authRole === "admin" ? adminApi : vendorApi;
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeUploadVariantIndex, setActiveUploadVariantIndex] = useState<number | null>(null);

  // Add a new blank variant
  const handleAddVariant = () => {
    // Infer default option names from existing variants if any
    const firstVariant = variants[0];
    const defaultOptions: VariantOptionItem[] =
      firstVariant && firstVariant.options.length > 0
        ? firstVariant.options.map((opt) => ({ name: opt.name, value: "" }))
        : [{ name: "Size", value: "" }];

    const newVariant: ProductVariantItem = {
      options: defaultOptions,
      stock: 10,
      images: [],
    };
    onChange([...variants, newVariant]);
  };

  // Remove a variant
  const handleRemoveVariant = (index: number) => {
    const updated = variants.filter((_, i) => i !== index);
    onChange(updated);
  };

  // Update variant stock
  const handleStockChange = (index: number, stock: number) => {
    const target = variants[index];
    if (!target) return;
    const updated = [...variants];
    updated[index] = { ...target, stock: Math.max(0, stock) };
    onChange(updated);
  };

  // Add an option attribute to a variant
  const handleAddOption = (variantIndex: number, name = "") => {
    const target = variants[variantIndex];
    if (!target) return;
    const updated = [...variants];
    updated[variantIndex] = {
      ...target,
      options: [...target.options, { name, value: "" }],
    };
    onChange(updated);
  };

  // Remove an option attribute from a variant
  const handleRemoveOption = (variantIndex: number, optionIndex: number) => {
    const target = variants[variantIndex];
    if (!target) return;
    const updated = [...variants];
    updated[variantIndex] = {
      ...target,
      options: target.options.filter((_, i) => i !== optionIndex),
    };
    onChange(updated);
  };

  // Update option name/value
  const handleOptionChange = (
    variantIndex: number,
    optionIndex: number,
    field: "name" | "value",
    val: string
  ) => {
    const target = variants[variantIndex];
    if (!target) return;
    const currentOption = target.options[optionIndex];
    if (!currentOption) return;
    const currentOptions = [...target.options];
    currentOptions[optionIndex] = {
      ...currentOption,
      [field]: val,
    };
    const updated = [...variants];
    updated[variantIndex] = {
      ...target,
      options: currentOptions,
    };
    onChange(updated);
  };

  // Add image URL directly
  const handleAddImageUrl = (variantIndex: number, url: string) => {
    if (!url.trim()) return;
    const target = variants[variantIndex];
    if (!target) return;
    const updated = [...variants];
    updated[variantIndex] = {
      ...target,
      images: [...target.images, url.trim()],
    };
    onChange(updated);
  };

  // Remove image from variant
  const handleRemoveImage = (variantIndex: number, imageIndex: number) => {
    const target = variants[variantIndex];
    if (!target) return;
    const updated = [...variants];
    updated[variantIndex] = {
      ...target,
      images: target.images.filter((_, i) => i !== imageIndex),
    };
    onChange(updated);
  };

  // Trigger file upload for a variant
  const triggerUploadForVariant = (index: number) => {
    setActiveUploadVariantIndex(index);
    fileInputRef.current?.click();
  };

  // Upload variant image handler
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || activeUploadVariantIndex === null) return;

    const file = files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image file must be smaller than 5 MB");
      return;
    }

    setUploadingIndex(activeUploadVariantIndex);
    const form = new FormData();
    form.append("files", file);

    try {
      const res = await api.post<unknown>("/images/upload", form);
      const rawData = res.data;
      const payload =
        typeof rawData === "object" && rawData !== null && "data" in rawData
          ? rawData.data
          : rawData;
      const uploaded = Array.isArray(payload) ? payload[0] : payload;
      const url =
        typeof uploaded === "string"
          ? uploaded
          : typeof uploaded === "object" && uploaded !== null && "url" in uploaded && typeof uploaded.url === "string"
            ? uploaded.url
            : typeof uploaded === "object" && uploaded !== null && "secure_url" in uploaded && typeof uploaded.secure_url === "string"
              ? uploaded.secure_url
              : undefined;

      if (url) {
        handleAddImageUrl(activeUploadVariantIndex, url);
        toast.success("Variant image uploaded!");
      }
    } catch {
      toast.error("Failed to upload image. Please try again.");
    } finally {
      setUploadingIndex(null);
      setActiveUploadVariantIndex(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className={cn("space-y-4 rounded-2xl border border-border/80 bg-card/60 p-4 sm:p-5 shadow-2xs", className)}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary shrink-0" />
          <div>
            <h4 className="text-sm font-bold text-foreground">Product Variants</h4>
            <p className="text-xs text-muted-foreground">
              Define options (e.g. Size, Color), specific stock quantity, and respective photos for each variation.
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={handleAddVariant}
          size="sm"
          className="gap-1.5 rounded-xl text-xs font-semibold h-8.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Variant Option
        </Button>
      </div>

      {/* Hidden file input for variant image upload */}
      <input
        ref={fileInputRef}
        id="variant-image-file-input"
        name="variantImageFile"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/jpg"
        className="hidden"
        onChange={handleFileChange}
      />

      {variants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 p-6 text-center bg-muted/20">
          <Layers className="mx-auto h-7 w-7 text-muted-foreground/60 mb-2" />
          <p className="text-xs font-semibold text-foreground">No variant options configured yet</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
            Add variations such as different sizes, colors, or materials with individual stock levels and photos.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddVariant}
            className="rounded-xl text-xs gap-1.5 border-border/80 hover:bg-secondary"
          >
            <Plus className="h-3.5 w-3.5" />
            Create First Variant
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {variants.map((variant, vIdx) => {
            const isUploadingThis = uploadingIndex === vIdx;
            return (
              <div
                key={vIdx}
                className="rounded-xl border border-border/80 bg-background/80 p-3.5 sm:p-4 shadow-2xs space-y-3 transition-all hover:border-border"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary text-[10px] font-bold">
                      {vIdx + 1}
                    </span>
                    <span className="text-xs font-bold text-foreground">
                      {variant.options.map((o) => o.value || o.name).filter(Boolean).join(" / ") ||
                        `Variant #${vIdx + 1}`}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveVariant(vIdx)}
                    className="p-1 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    title="Remove variant"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-start">
                  {/* Options Attributes (e.g. Size, Color) */}
                  <div className="md:col-span-6 space-y-2">
                    <Label className="text-[11px] font-semibold text-muted-foreground">
                      Attribute Options (e.g. Size, Color)
                    </Label>

                    <div className="space-y-2">
                      {variant.options.map((option, oIdx) => (
                        <div key={oIdx} className="flex items-center gap-2">
                          <Input
                            id={`variant_${vIdx}_attr_${oIdx}_name`}
                            name={`variant_${vIdx}_attr_${oIdx}_name`}
                            aria-label={`Variant ${vIdx + 1} Attribute Name`}
                            placeholder="Attribute (e.g. Size)"
                            value={option.name}
                            onChange={(e) =>
                              handleOptionChange(vIdx, oIdx, "name", e.target.value)
                            }
                            className="h-8.5 rounded-lg text-xs w-1/2 bg-card"
                          />
                          <Input
                            id={`variant_${vIdx}_attr_${oIdx}_val`}
                            name={`variant_${vIdx}_attr_${oIdx}_val`}
                            aria-label={`Variant ${vIdx + 1} Attribute Value`}
                            placeholder="Value (e.g. XL, Blue)"
                            value={option.value}
                            onChange={(e) =>
                              handleOptionChange(vIdx, oIdx, "value", e.target.value)
                            }
                            className="h-8.5 rounded-lg text-xs w-1/2 bg-card font-medium"
                          />
                          {variant.options.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveOption(vIdx, oIdx)}
                              className="text-muted-foreground hover:text-destructive p-1"
                              title="Remove attribute"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleAddOption(vIdx)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                      >
                        <Plus className="h-3 w-3" />
                        Add Attribute Pair
                      </button>

                      <span className="text-muted-foreground/40 text-[10px]">· Presets:</span>
                      {COMMON_ATTRIBUTES.filter(
                        (attr) => !variant.options.some((o) => o.name.toLowerCase() === attr.toLowerCase())
                      )
                        .slice(0, 3)
                        .map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => handleAddOption(vIdx, preset)}
                            className="text-[10px] px-1.5 py-0.5 rounded-md bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 font-medium transition-colors"
                          >
                            +{preset}
                          </button>
                        ))}
                    </div>
                  </div>

                  {/* Stock Level */}
                  <div className="md:col-span-2 space-y-1.5">
                    <Label className="text-[11px] font-semibold text-muted-foreground">
                      Stock Count
                    </Label>
                    <Input
                      id={`variant_${vIdx}_stock`}
                      name={`variant_${vIdx}_stock`}
                      aria-label={`Variant ${vIdx + 1} Stock Count`}
                      type="number"
                      min={0}
                      value={variant.stock}
                      onChange={(e) => handleStockChange(vIdx, parseInt(e.target.value) || 0)}
                      className="h-8.5 rounded-lg text-xs bg-card font-semibold"
                    />
                  </div>

                  {/* Variant-specific Photos */}
                  <div className="md:col-span-4 space-y-1.5">
                    <Label className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                      <span>Variant Photo</span>
                      <button
                        type="button"
                        onClick={() => triggerUploadForVariant(vIdx)}
                        disabled={isUploadingThis}
                        className="text-[10px] font-semibold text-primary hover:underline flex items-center gap-1"
                      >
                        {isUploadingThis ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <UploadCloud className="h-2.5 w-2.5" />
                        )}
                        Upload
                      </button>
                    </Label>

                    {variant.images && variant.images.length > 0 ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        {variant.images.map((imgUrl, imgIdx) => (
                          <div
                            key={imgIdx}
                            className="relative h-14 w-14 overflow-hidden rounded-xl border border-border group shrink-0"
                          >
                            
                            <RemoteImage
                              src={imgUrl}
                              alt={`Variant ${vIdx + 1}`}
                              className="h-full w-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemoveImage(vIdx, imgIdx)}
                              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => triggerUploadForVariant(vIdx)}
                        disabled={isUploadingThis}
                        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-muted/20 text-muted-foreground hover:border-primary/50 hover:bg-primary/5 text-xs transition-colors"
                      >
                        {isUploadingThis ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        ) : (
                          <>
                            <ImageIcon className="h-3.5 w-3.5" />
                            <span className="text-[11px]">Attach photo</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
