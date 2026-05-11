import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import Cropper from 'react-easy-crop';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { UploadCloud, Trash2, Download, Settings, Image as ImageIcon, X, Loader2, FolderDown } from 'lucide-react';

type AspectRatio = '1:1' | '16:9' | '4:3' | '9:16' | '3:4' | 'free';
type Resolution = 1024 | 2048 | 4096;
type Format = 'image/jpeg' | 'image/png' | 'image/webp';

interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
  crop: { x: number; y: number };
  zoom: number;
  croppedAreaPixels: { x: number; y: number; width: number; height: number } | null;
}

const getAspectValue = (ratio: AspectRatio): number | undefined => {
  switch (ratio) {
    case '1:1': return 1;
    case '16:9': return 16 / 9;
    case '4:3': return 4 / 3;
    case '9:16': return 9 / 16;
    case '3:4': return 3 / 4;
    default: return undefined;
  }
};

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  resolution: number,
  format: Format
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('No 2d context');
  }

  // Calculate target dimensions
  // The longest side should be `resolution`
  let targetWidth, targetHeight;
  if (pixelCrop.width > pixelCrop.height) {
    targetWidth = resolution;
    targetHeight = Math.round((pixelCrop.height / pixelCrop.width) * resolution);
  } else {
    targetHeight = resolution;
    targetWidth = Math.round((pixelCrop.width / pixelCrop.height) * resolution);
  }

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    targetWidth,
    targetHeight
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      if (file) resolve(file);
      else reject(new Error('Canvas is empty'));
    }, format, 0.9);
  });
}

export default function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [resolution, setResolution] = useState<Resolution>(1024);
  const [format, setFormat] = useState<Format>('image/jpeg');
  const [isProcessing, setIsProcessing] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newImages = acceptedFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      previewUrl: URL.createObjectURL(file),
      crop: { x: 0, y: 0 },
      zoom: 1,
      croppedAreaPixels: null,
    }));
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp'],
    },
    noClick: images.length > 0,
    multiple: true,
  } as any);

  const removeImage = (id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const clearAll = () => {
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
  };

  const updateImage = (id: string, updates: Partial<ImageItem>) => {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...updates } : img)));
  };

  const handleSaveAll = async () => {
    if (images.length === 0) return;
    setIsProcessing(true);
    console.log('Starting save process for', images.length, 'images');

    try {
      // Check if we have cropped areas for all images
      const imagesToProcess = images.filter(img => img.croppedAreaPixels !== null);
      
      if (imagesToProcess.length === 0) {
        console.warn('No images have crop data yet. Waiting a moment...');
        // Small delay to allow cropper to initialize if just added
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const finalImagesToProcess = images.filter(img => img.croppedAreaPixels !== null);
      if (finalImagesToProcess.length === 0) {
        alert('Images are still loading or have not been processed. Please try again in a moment.');
        setIsProcessing(false);
        return;
      }

      let dirHandle;
      try {
        if ('showDirectoryPicker' in window) {
           // @ts-ignore
          dirHandle = await window.showDirectoryPicker({
            mode: 'readwrite',
          });
        } else {
          throw new Error('FileSystemAccessAPI not supported');
        }
      } catch (err: any) {
        console.log('Directory Picker failed or not supported, falling back to ZIP:', err.name || err.message);
        if (err.name === 'AbortError') {
          setIsProcessing(false);
          return;
        }
        await saveAsZip();
        setIsProcessing(false);
        return;
      }

      let count = 0;
      for (const img of finalImagesToProcess) {
        if (!img.croppedAreaPixels) continue;

        try {
          const blob = await getCroppedImg(
            img.previewUrl,
            img.croppedAreaPixels,
            resolution,
            format
          );

          const extension = format === 'image/jpeg' ? 'jpg' : format.split('/')[1];
          const originalName = img.file.name.replace(/\.[^/.]+$/, '');
          const newFileName = `${originalName}_cropped.${extension}`;

          const fileHandle = await dirHandle.getFileHandle(newFileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          count++;
        } catch (imgErr) {
          console.error(`Error processing image ${img.file.name}:`, imgErr);
        }
      }

      alert(`${count} images saved successfully to the directory!`);
    } catch (error) {
      console.error('Final error in handleSaveAll:', error);
      alert('An error occurred while processing images. Check the console for details.');
    } finally {
      setIsProcessing(false);
    }
  };

  const saveAsZip = async () => {
    console.log('Generating ZIP file...');
    const zip = new JSZip();
    let count = 0;

    for (const img of images) {
      if (!img.croppedAreaPixels) {
        console.warn(`Skipping ${img.file.name} because it has no crop data`);
        continue;
      }

      try {
        const blob = await getCroppedImg(
          img.previewUrl,
          img.croppedAreaPixels,
          resolution,
          format
        );

        const extension = format === 'image/jpeg' ? 'jpg' : format.split('/')[1];
        const originalName = img.file.name.replace(/\.[^/.]+$/, '');
        const newFileName = `${originalName}_cropped.${extension}`;

        zip.file(newFileName, blob);
        count++;
      } catch (imgErr) {
        console.error(`Error adding ${img.file.name} to ZIP:`, imgErr);
      }
    }

    if (count === 0) {
      alert('No images ready to be saved.');
      return;
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'cropped_images.zip');
    console.log('ZIP file downloaded successfully');
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-300 font-sans overflow-hidden">
      {/* Main Content Area */}
      <div
        {...getRootProps()}
        className={`flex-1 flex flex-col relative transition-colors ${
          isDragActive ? 'bg-zinc-900/50' : ''
        }`}
      >
        <input {...getInputProps()} />
        
        {/* Header */}
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 shrink-0 bg-zinc-950/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-2 text-zinc-100 font-medium">
            <ImageIcon className="w-5 h-5 text-indigo-400" />
            <span>BatchCrop</span>
          </div>
          
          {images.length > 0 && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-zinc-500">{images.length} images</span>
              <button
                onClick={(e) => { e.stopPropagation(); clearAll(); }}
                className="text-sm text-zinc-400 hover:text-red-400 transition-colors"
              >
                Clear all
              </button>
              <label className="text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-md cursor-pointer transition-colors">
                Add more
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) {
                      onDrop(Array.from(e.target.files));
                    }
                  }}
                />
              </label>
            </div>
          )}
        </header>

        {/* Grid Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {images.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-4">
              <div className="w-24 h-24 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800 border-dashed">
                <UploadCloud className="w-10 h-10 text-zinc-600" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-zinc-300">Drag your images here</p>
                <p className="text-sm mt-1">or click to select files</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {images.map((img) => (
                <div
                  key={img.id}
                  className={`relative aspect-square bg-zinc-900 rounded-xl overflow-hidden group border transition-all shadow-sm ${
                    img.croppedAreaPixels ? 'border-zinc-800' : 'border-amber-500/50 grayscale'
                  }`}
                  onClick={(e) => e.stopPropagation()} // Prevent triggering dropzone click
                >
                  <Cropper
                    image={img.previewUrl}
                    crop={img.crop}
                    zoom={img.zoom}
                    aspect={getAspectValue(aspectRatio)}
                    onCropChange={(crop) => updateImage(img.id, { crop })}
                    onZoomChange={(zoom) => updateImage(img.id, { zoom })}
                    onCropComplete={(_, croppedAreaPixels) =>
                      updateImage(img.id, { croppedAreaPixels })
                    }
                    classes={{
                      containerClassName: 'bg-zinc-900',
                    }}
                  />
                  
                  {!img.croppedAreaPixels && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-20">
                      <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                    </div>
                  )}

                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-30 flex gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeImage(img.id);
                      }}
                      className="bg-black/50 hover:bg-red-500/80 text-white p-1.5 rounded-md backdrop-blur-sm transition-colors"
                      title="Remover"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent pointer-events-none z-30">
                    <p className="text-xs text-zinc-300 truncate">{img.file.name}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Settings Sidebar */}
      <div className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col shrink-0 z-20 shadow-xl">
        <div className="p-6 border-b border-zinc-800">
          <h2 className="text-lg font-medium text-zinc-100 flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Settings
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Aspect Ratio */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
              Aspect Ratio
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['1:1', '16:9', '4:3', '9:16', '3:4', 'free'] as AspectRatio[]).map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => setAspectRatio(ratio)}
                  className={`py-2 text-sm rounded-md transition-colors ${
                    aspectRatio === ratio
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/50'
                      : 'bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700'
                  }`}
                >
                  {ratio === 'free' ? 'Free' : ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
              Resolution (Longest side)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([1024, 2048, 4096] as Resolution[]).map((res) => (
                <button
                  key={res}
                  onClick={() => setResolution(res)}
                  className={`py-2 text-sm rounded-md transition-colors ${
                    resolution === res
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/50'
                      : 'bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700'
                  }`}
                >
                  {res === 1024 ? '1K' : res === 2048 ? '2K' : '4K'}
                </button>
              ))}
            </div>
          </div>

          {/* Format */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
              Output Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['image/jpeg', 'image/png', 'image/webp'] as Format[]).map((fmt) => {
                const label = fmt.split('/')[1].toUpperCase();
                return (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
                    className={`py-2 text-sm rounded-md transition-colors ${
                      format === fmt
                        ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/50'
                        : 'bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-6 border-t border-zinc-800 bg-zinc-900/50 space-y-3">
          <button
            onClick={handleSaveAll}
            disabled={images.length === 0 || isProcessing}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white py-3 rounded-lg font-medium transition-colors"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <FolderDown className="w-5 h-5" />
                Save to Folder
              </>
            )}
          </button>
          
          <button
            onClick={saveAsZip}
            disabled={images.length === 0 || isProcessing}
            className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-300 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Download as ZIP
          </button>

          <p className="text-xs text-zinc-500 text-center mt-2 leading-relaxed">
            "Save to Folder" may not work in all browsers. Use "Download as ZIP" as an alternative.
          </p>
        </div>
      </div>
    </div>
  );
}
