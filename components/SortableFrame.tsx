import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Frame } from '../types';
import { X, GripVertical } from 'lucide-react';
import { motion } from 'framer-motion';

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

  return (
    <motion.div
      layout
      layoutId={frame.id} // Enable magic motion from canvas to list
      ref={setNodeRef}
      style={style}
      data-id={frame.id}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0, transition: { duration: 0.2 } }}
      transition={{ 
        layout: { type: "spring", bounce: 0.2, duration: 0.3 }
      }}
      whileHover={{ scale: 1.05, y: -2, zIndex: 10 }}
      whileTap={{ scale: 0.95 }}
      className={`sortable-frame relative group flex-shrink-0 w-24 h-32 bg-white dark:bg-zinc-900 rounded-lg border select-none overflow-hidden ${
        isSelected 
            ? 'border-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.5)] z-10' 
            : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-xl dark:hover:shadow-zinc-900/50'
      } ${isDragging ? 'shadow-2xl opacity-80 cursor-grabbing' : ''}`}
      onClick={(e) => onSelect(frame.id, e)}
      onContextMenu={(e) => onContextMenu(frame.id, e)}
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
            className="max-w-full max-h-full object-contain pointer-events-none select-none transition-transform duration-300 group-hover:scale-110"
            draggable={false}
          />
        ) : (
          <div className="animate-pulse bg-zinc-200 dark:bg-zinc-800 w-full h-full rounded" />
        )}
      </div>

      {/* Delete Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(frame.id);
        }}
        className="absolute top-1 right-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 text-white rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 z-20 scale-50 group-hover:scale-100 shadow-sm"
        title="删除"
      >
        <X size={10} />
      </button>
      
      {/* Selection Overlay (Subtle tint) */}
      {isSelected && <div className="absolute inset-0 bg-blue-500/5 pointer-events-none animate-fade-in" />}
    </motion.div>
  );
};