"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createApiClient } from "@/lib/api";
import { toast } from "@/lib/toast";

interface AvatarCropDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiToken: string;
  onAvatarUpdated: (newUrl: string) => void;
}

const MAX_AVATAR_BYTES = 1 * 1024 * 1024; // 1MB
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function AvatarCropDialog({
  open,
  onOpenChange,
  apiToken,
  onAvatarUpdated,
}: AvatarCropDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedFile(null);
      setImageSrc(null);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setError(null);
      setLoading(false);
    }
  }, [open]);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setError("Please select a PNG, JPEG, or WebP image.");
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      setError("File exceeds maximum allowed size of 1MB.");
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      setImageSrc(src);
      const img = new Image();
      img.onload = () => {
        imageRef.current = img;
        setZoom(1);
        setPan({ x: 0, y: 0 });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  // Draw crop preview on canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);

    // Calculate dimensions with zoom and pan
    const aspect = img.width / img.height;
    let drawWidth = size * zoom;
    let drawHeight = size * zoom;

    if (aspect > 1) {
      drawWidth = size * aspect * zoom;
    } else {
      drawHeight = (size / aspect) * zoom;
    }

    const drawX = (size - drawWidth) / 2 + pan.x;
    const drawY = (size - drawHeight) / 2 + pan.y;

    ctx.save();
    // Clip to circle preview
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    // Circle border guide
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(99, 102, 241, 0.8)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }, [zoom, pan]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas, imageSrc, zoom, pan]);

  // Dragging handlers for repositioning
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Generate cropped blob and upload
  const handleSaveCrop = async () => {
    const img = imageRef.current;
    if (!img) return;

    setLoading(true);
    setError(null);

    try {
      // Offscreen export canvas 200x200
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = 200;
      exportCanvas.height = 200;
      const ctx = exportCanvas.getContext("2d");
      if (!ctx) throw new Error("Could not initialize export canvas");

      const size = 200;
      const aspect = img.width / img.height;
      let drawWidth = size * zoom;
      let drawHeight = size * zoom;

      if (aspect > 1) {
        drawWidth = size * aspect * zoom;
      } else {
        drawHeight = (size / aspect) * zoom;
      }

      // Scale pan relative to 200px export size
      const scale = 200 / 280;
      const drawX = (size - drawWidth) / 2 + pan.x * scale;
      const drawY = (size - drawHeight) / 2 + pan.y * scale;

      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      const blob = await new Promise<Blob | null>((resolve) =>
        exportCanvas.toBlob(resolve, "image/webp", 0.9)
      );

      if (!blob) throw new Error("Failed to process cropped avatar");

      const formData = new FormData();
      formData.append("avatar", blob, "avatar.webp");

      const client = createApiClient(apiToken);
      const res = await client.post("/users/me/avatar", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const newUrl = res.data.avatarUrl || res.data.publicUrl;
      onAvatarUpdated(newUrl);
      toast.success("Avatar updated successfully!");
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to upload avatar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update Profile Avatar</DialogTitle>
          <DialogDescription>
            Upload a custom avatar (PNG, JPEG, WebP up to 1MB). Pan and zoom to crop.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            id="avatar-file-input"
          />

          {!imageSrc ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="hover:bg-[var(--muted)]/20 flex h-64 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border)] p-6 transition-colors hover:border-[var(--primary)]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--muted)] text-2xl">
                📷
              </div>
              <p className="mt-3 text-sm font-medium">Click or drag image to upload</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                PNG, JPG, or WebP up to 1MB
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <canvas
                ref={canvasRef}
                width={280}
                height={280}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                className="cursor-move rounded-full border border-[var(--border)] bg-neutral-900 shadow-sm"
              />

              <div className="w-full space-y-1">
                <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
                  <span>Zoom</span>
                  <span>{Math.round(zoom * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                  className="w-full accent-[var(--primary)]"
                />
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose different image
              </Button>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <DialogFooter className="flex gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!imageSrc || loading}
            onClick={() => void handleSaveCrop()}
          >
            {loading ? "Uploading..." : "Save Avatar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
