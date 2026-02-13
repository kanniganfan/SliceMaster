import React, { useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Frame } from '../types';
import { X, GripVertical } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

interface SortableFrameProps {
  frame: Frame;
  index: number;
  isSelected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}

export const SortableFrame: React.FC<SortableFrameProps> = ({ 
  frame, 
  index, 
  isSelected, 
  onSelect, 
  onDelete,
  onContextMenu
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: frame.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);

  useGSAP(() => {
    // Entrance Animation - Elastic Pop
    gsap.from(containerRef.current, {
        scale: 0,
        opacity: 0,
        duration: 0.6,
        ease: "back.out(1.7)",
        delay: index * 0.05 // Stagger based on index
    });
  }, { scope: containerRef });

  const handleMouseEnter = () => {
      if (isDragging) return;
      gsap.to(containerRef.current, {
          y: -4,
          scale: 1.05,
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          duration: 0.3,
          ease: "power2.out"
      });
      gsap.to(deleteBtnRef.current, {
          opacity: 1,
          scale: 1,
          duration: 0.2
      });
  };

  const handleMouseLeave = () => {
      if (isDragging) return;
      gsap.to(containerRef.current, {
          y: 0,
          scale: 1,
          boxShadow: "none",
          duration: 0.3,
          ease: "power2.out"
      });
      gsap.to(deleteBtnRef.current, {
          opacity: 0,
          scale: 0.5,
          duration: 0.2
      });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="outline-none" // Wrapper for dnd-kit refs
    >
        <div
            ref={containerRef}
            data-id={frame.id}
            className={`sortable-frame relative flex-shrink-0 w-24 h-32 bg-white dark:bg-zinc-900 rounded-lg border select-none overflow-hidden cursor-pointer ${
                isSelected 
                    ? 'border-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.5)] z-10' 
                    : 'border-zinc-200 dark:border-zinc-800'
            } ${isDragging ? 'shadow-2xl opacity-80 cursor-grabbing' : ''}`}
            onClick={(e) => onSelect(frame.id, e)}
            onContextMenu={(e) => onContextMenu(frame.id, e)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* Header with drag handle and number */}
            <div className={`absolute top-0 left-0 right-0 h-6 flex items-center justify-between px-1.5 z-10 transition-colors duration-200 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-white/90 dark:bg-zinc-900/90'}`}>
                <span className={`text-[10px] font-mono font-bold transition-colors ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
                    {String(index + 1).padStart(2, '0')}
                </span>
                <button 
                {...attributes} 
                {...listeners} 
                className="cursor-grab active:cursor-grabbing text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300 p-0.5 transition-colors outline-none"
                onClick={(e) => e.stopPropagation()} 
                >
                <GripVertical size={12} />
                </button>
            </div>

            {/* Frame Preview */}
            <div className="w-full h-full pt-6 pb-2 px-2 flex items-center justify-center checkerboard">
                {frame.imageData ? (
                <img 
                    src={frame.imageData} 
                    alt={`Frame ${index}`} 
                    className="max-w-full max-h-full object-contain pointer-events-none select-none"
                    draggable={false}
                />
                ) : (
                <div className="bg-zinc-200 dark:bg-zinc-800 w-full h-full rounded opacity-50" />
                )}
            </div>

            {/* Delete Button */}
            <button
                ref={deleteBtnRef}
                onClick={(e) => {
                e.stopPropagation();
                // Animate out before delete callback
                gsap.to(containerRef.current, {
                    scale: 0,
                    opacity: 0,
                    duration: 0.2,
                    onComplete: () => onDelete(frame.id)
                });
                }}
                className="absolute top-1 right-1 w-4 h-4 bg-red-500/90 hover:bg-red-500 text-white rounded flex items-center justify-center z-20 shadow-sm opacity-0 scale-50"
                title="删除"
            >
                <X size={10} />
            </button>
            
            {/* Selection Overlay (Subtle tint) */}
            {isSelected && <div className="absolute inset-0 bg-blue-500/5 pointer-events-none" />}
        </div>
    </div>
  );
};