import { Button } from "@/components/ui/button";
import { Settings, Trash2 } from "lucide-react";
import type { Project } from "../../App";

interface ProjectTileProps {
  project: Project;
  onOpen: () => void;
  onSettings: () => void;
  onDelete: () => void;
  animationDelay?: number;
}

export default function ProjectTile({
  project,
  onOpen,
  onSettings,
  onDelete,
  animationDelay = 0,
}: ProjectTileProps) {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <button
      type="button"
      data-ocid="project-tile"
      className="group relative bg-card border border-border rounded-3xl p-6 cursor-pointer card-inset-glow transition-[box-shadow,border-color,transform] duration-component ease-apple hover:border-primary/40 text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 fade-in-scale"
      style={{
        animationDelay: `${animationDelay}ms`,
        animationFillMode: "both",
      }}
      onClick={onOpen}
    >
      {/* Blockchain/Protocol Tag */}
      <div className="inline-flex items-center px-3 py-1 bg-muted/40 border border-border rounded-full mb-4 transition-[border-color,background-color] duration-hover ease-apple group-hover:border-primary/30">
        <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
          {project.blockchain || "SOL"}
        </span>
      </div>

      {/* Project Name */}
      <h3 className="text-2xl font-bold text-foreground mb-2 tracking-tight">
        {project.name}
      </h3>

      {/* Collection Size */}
      <div className="text-sm text-muted-foreground font-medium mb-4">
        <span className="uppercase tracking-wide">
          {project.collectionSize} units protocol
        </span>
      </div>

      {/* Initialized Date */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground/60 font-medium mb-6">
        <span className="uppercase tracking-wider">Initialized</span>
        <span>{formatDate(project.createdAt)}</span>
      </div>

      {/* Action Buttons */}
      <div className="absolute top-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-[opacity] duration-component ease-apple">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Project settings"
          onClick={(e) => {
            e.stopPropagation();
            onSettings();
          }}
          className="h-9 w-9 rounded-lg bg-background/80 backdrop-blur-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted motion-press-snappy transition-[color,background-color,border-color] duration-hover ease-apple"
        >
          <Settings className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete project"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="h-9 w-9 rounded-lg bg-background/80 backdrop-blur-sm border border-border text-destructive hover:text-destructive hover:bg-destructive/10 motion-press-snappy transition-[color,background-color,border-color] duration-hover ease-apple"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </button>
  );
}
