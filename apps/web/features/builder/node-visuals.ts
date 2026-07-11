import {
  Blocks,
  Bot,
  Braces,
  CircleHelp,
  Database,
  GitFork,
  MessageCircle,
  MessageSquareReply,
  Play,
  Shuffle,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

/** Resolución de iconos declarados por las definiciones de nodos (nunca emojis). */
const ICONS: Record<string, LucideIcon> = {
  play: Play,
  shuffle: Shuffle,
  'message-square-reply': MessageSquareReply,
  'message-circle': MessageCircle,
  webhook: Webhook,
  'git-fork': GitFork,
  braces: Braces,
  database: Database,
  bot: Bot,
  users: Users,
  blocks: Blocks,
};

export function nodeIcon(name: string): LucideIcon {
  return ICONS[name] ?? CircleHelp;
}

/** Color de acento por categoría (borde superior del nodo y paleta) */
export const CATEGORY_COLORS: Record<string, string> = {
  trigger: 'var(--color-success)',
  logic: 'var(--color-warning)',
  data: 'var(--brand-accent)',
  communication: '#a78bfa',
  ai: '#f472b6',
  contacts: '#38bdf8',
  whatsapp: '#4ade80',
  integrations: '#fb923c',
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? 'var(--color-border-strong)';
}
