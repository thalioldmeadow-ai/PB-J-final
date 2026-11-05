/**
 * In-house icon set.
 *
 * Drawn here instead of pulled from an icon library: 24x24 grid, single stroke,
 * square caps and mitre joins so nothing looks soft or rounded. There is no
 * sparkle glyph in this set on purpose.
 */
import type { ReactNode, SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

const icon = (children: ReactNode) => {
  const Glyph = ({ className, size = 24, strokeWidth = 1.5, ...rest }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
  return Glyph;
};

const dot = (cx: number, cy: number, r = 1) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

export const Activity = icon(<path d="M2 12h4l2.5-7 3.5 14 2.5-7H22" />);
export const AlertCircle = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></>);
export const ArrowDown = icon(<path d="M12 3v17M5 13l7 7 7-7" />);
export const ArrowUp = icon(<path d="M12 21V4M5 11l7-7 7 7" />);
export const ArrowRight = icon(<path d="M3 12h17M13 5l7 7-7 7" />);
export const ArrowUpRight = icon(<path d="M5 19L19 5M10 5h9v9" />);
export const Banknote = icon(<><rect x="2" y="6" width="20" height="12" /><circle cx="12" cy="12" r="3" /></>);
export const BarChart3 = icon(<path d="M3 21h18M7 21V11M12 21V4M17 21v-7" />);
export const Bed = icon(<path d="M2 20v-9h16a4 4 0 014 4v5M2 15h20M6 11V7h5v4" />);
export const Beef = icon(<><path d="M6 15a6 6 0 016-6h3a4 4 0 014 4v2a6 6 0 01-6 6H9a3 3 0 01-3-3z" />{dot(14, 11, 1.4)}</>);
export const Book = icon(<path d="M4 4h11a3 3 0 013 3v13H7a3 3 0 00-3 3z" />);
export const BookMarked = icon(<><path d="M4 4h11a3 3 0 013 3v13H7a3 3 0 00-3 3z" /><path d="M10 4v7l2-2 2 2V4" /></>);
export const BookOpen = icon(<path d="M12 6C10 4 6.5 4 3 4v14c3.5 0 7 0 9 2 2-2 5.5-2 9-2V4c-3.5 0-7 0-9 2zM12 6v14" />);
export const Bot = icon(<><rect x="5" y="8" width="14" height="11" /><path d="M12 4v4M9 13h.5M14.5 13h.5M9 16h6" /></>);
export const Brain = icon(<><path d="M9 4a3 3 0 00-3 3v1a3 3 0 000 6v2a3 3 0 003 3h6a3 3 0 003-3v-2a3 3 0 000-6V7a3 3 0 00-3-3z" /><path d="M12 4v16" /></>);
export const Briefcase = icon(<><rect x="3" y="7" width="18" height="13" /><path d="M9 7V4h6v3M3 12h18" /></>);
export const Calendar = icon(<><rect x="3" y="5" width="18" height="16" /><path d="M8 3v4M16 3v4M3 10h18" /></>);
export const CalendarDays = icon(<><rect x="3" y="5" width="18" height="16" /><path d="M8 3v4M16 3v4M3 10h18" />{dot(8, 14)} {dot(12, 14)} {dot(16, 14)} {dot(8, 18)} {dot(12, 18)}</>);
export const Camera = icon(<><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13" r="3.5" /></>);
export const Car = icon(<><path d="M4 17v-5l2-5h12l2 5v5z" /><path d="M4 12h16M7 17v2M17 17v2" /></>);
export const Check = icon(<path d="M4 12l5 5L20 6" />);
export const CheckCircle2 = icon(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>);
export const ChevronDown = icon(<path d="M5 9l7 7 7-7" />);
export const ChevronUp = icon(<path d="M5 15l7-7 7 7" />);
export const ChevronLeft = icon(<path d="M15 5l-7 7 7 7" />);
export const ChevronRight = icon(<path d="M9 5l7 7-7 7" />);
export const Circle = icon(<circle cx="12" cy="12" r="9" />);
export const Clock = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" /></>);
export const Cloud = icon(<path d="M7 18a4 4 0 010-8 5 5 0 019.6-1.4A3.5 3.5 0 0117 18z" />);
export const CloudSun = icon(<><circle cx="8" cy="8" r="3" /><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1M11 19a3.5 3.5 0 010-7 4.5 4.5 0 018.6-1.2A3 3 0 0119.5 19z" /></>);
export const Coffee = icon(<><path d="M4 8h13v7a4 4 0 01-4 4H8a4 4 0 01-4-4z" /><path d="M17 10h2a2 2 0 010 4h-2M6 4v2M10 4v2M14 4v2" /></>);
export const Coins = icon(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>);
export const Compass = icon(<><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>);
export const Copy = icon(<><rect x="9" y="9" width="11" height="11" /><path d="M15 9V4H4v11h5" /></>);
export const Croissant = icon(<><path d="M3 15a9 9 0 0118 0c0 3-4 4.5-9 4.5S3 18 3 15z" /><path d="M7 15.5c0-3 2-5.5 5-5.5s5 2.5 5 5.5" /></>);
export const DollarSign = icon(<path d="M12 3v18M16 7.5C16 6 14.2 5 12 5S8 6 8 8s2 3 4 3.5 4 1 4 3-1.8 3-4 3-4-1-4-2.5" />);
export const Droplets = icon(<><path d="M12 3l3 4.5a3.5 3.5 0 01-6 0z" /><path d="M6 12l2 3a2.5 2.5 0 01-4 0zM18 12l2 3a2.5 2.5 0 01-4 0z" /></>);
export const Dumbbell = icon(<path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" />);
export const Edit3 = icon(<path d="M4 20h4L20 8l-4-4L4 16zM14 6l4 4" />);
export const Egg = icon(<path d="M12 3c3.5 0 6 5 6 9a6 6 0 01-12 0c0-4 2.5-9 6-9z" />);
export const ExternalLink = icon(<path d="M10 4H4v16h16v-6M14 4h6v6M20 4l-8 8" />);
export const Eye = icon(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeOff = icon(<path d="M3 3l18 18M10.6 6.2A9.7 9.7 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3 3.6M6.5 8.5A16 16 0 002 12s3.5 6 10 6a9.5 9.5 0 004-1" />);
export const Feather = icon(<path d="M20 4L9 15M20 4c0 7-5 13-13 13M6 20l3-3" />);
export const Filter = icon(<path d="M3 4h18l-7 8v7l-4 2v-9z" />);
export const Flame = icon(<path d="M12 3c4 4 6 6.5 6 10a6 6 0 01-12 0c0-2 1-3.5 2.5-4.5 0 2 1 3 2 3s2-1.5 1.5-4c0-.5-.5-3 0-4.5z" />);
export const FolderHeart = icon(<><path d="M3 6h6l2 2h10v11H3z" /><path d="M12 17s-3-1.8-3-3.8a1.7 1.7 0 013-.9 1.7 1.7 0 013 .9c0 2-3 3.8-3 3.8z" /></>);
export const Footprints = icon(<><path d="M6 4c-1.7 0-2.5 2.6-2.5 4.4S4.3 12 6 12s2.5-1.8 2.5-3.6S7.7 4 6 4z" /><path d="M18 11c-1.7 0-2.5 2.6-2.5 4.4S16.3 19 18 19s2.5-1.8 2.5-3.6S19.7 11 18 11zM5 15v4M19 4v3" /></>);
export const Frown = icon(<><circle cx="12" cy="12" r="9" /><path d="M8 16c1.2-1.5 2.5-2 4-2s2.8.5 4 2M9 9.5h.5M14.5 9.5h.5" /></>);
export const GripVertical = icon(<>{dot(9, 5, 1.3)} {dot(9, 12, 1.3)} {dot(9, 19, 1.3)} {dot(15, 5, 1.3)} {dot(15, 12, 1.3)} {dot(15, 19, 1.3)}</>);
export const Heart = icon(<path d="M12 20S4 15.5 4 10.5A4.2 4.2 0 0112 8a4.2 4.2 0 018 2.5C20 15.5 12 20 12 20z" />);
export const HeartPulse = icon(<path d="M12 20S4 15.5 4 10.5A4.2 4.2 0 0112 8a4.2 4.2 0 018 2.5c0 1.5-.8 3-2 4.5M14 12h3l1.5-2 1.5 4 1.5-2H23" />);
export const HelpCircle = icon(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5A2.5 2.5 0 0114.5 10c0 1.5-2.5 2-2.5 3.5M12 17v.5" /></>);
export const History = icon(<><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.5M3 4v4h4" /><path d="M12 7v5l3.5 2" /></>);
export const Home = icon(<path d="M3 11l9-8 9 8v10H3zM10 21v-6h4v6" />);
export const Info = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 10v7M12 7v.5" /></>);
export const Layout = icon(<><rect x="3" y="4" width="18" height="16" /><path d="M3 10h18M9 10v10" /></>);
export const Leaf = icon(<path d="M20 4c0 9-6 16-16 16 0-8 6-16 16-16zM10 14l6-6" />);
export const Lightbulb = icon(<><path d="M12 3a6 6 0 00-3 11v3h6v-3a6 6 0 00-3-11z" /><path d="M10 20h4M11 22h2" /></>);
export const Link2 = icon(<><path d="M9 15l6-6" /><path d="M13 4l1.5-1.5a4 4 0 015.6 5.6L18.5 10M11 20l-1.5 1.5a4 4 0 01-5.6-5.6L5.5 14" /></>);
export const List = icon(<><path d="M8 6h13M8 12h13M8 18h13" />{dot(4, 6, 1.2)} {dot(4, 12, 1.2)} {dot(4, 18, 1.2)}</>);
export const ListTodo = icon(<><path d="M10 6h11M10 12h11M10 18h11" /><path d="M3 6l1.5 1.5L7 5M3 17l1.5 1.5L7 16" /></>);
export const Loader2 = icon(<path d="M12 3a9 9 0 019 9" />);
export const Lock = icon(<><rect x="4" y="10" width="16" height="11" /><path d="M8 10V7a4 4 0 018 0v3" /></>);
export const Unlock = icon(<><rect x="4" y="10" width="16" height="11" /><path d="M8 10V7a4 4 0 017-2.6" /></>);
export const LogIn = icon(<path d="M14 4h6v16h-6M4 12h11M11 8l4 4-4 4" />);
export const LogOut = icon(<path d="M10 4H4v16h6M9 12h11M16 8l4 4-4 4" />);
export const Mail = icon(<><rect x="2" y="5" width="20" height="14" /><path d="M2 6l10 7 10-7" /></>);
export const Maximize2 = icon(<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />);
export const Meh = icon(<><circle cx="12" cy="12" r="9" /><path d="M8 15h8M9 9.5h.5M14.5 9.5h.5" /></>);
export const MessageSquare = icon(<path d="M3 4h18v13H8l-5 4z" />);
export const Mic = icon(<><rect x="9" y="3" width="6" height="10" /><path d="M5 11a7 7 0 0014 0M12 18v3M8 21h8" /></>);
export const MicOff = icon(<path d="M3 3l18 18M9 4h3a3 3 0 013 3v4M15 13a3 3 0 01-5.5 1.5M5 11a7 7 0 0011 5.8M12 18v3M8 21h8" />);
export const Moon = icon(<path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z" />);
export const Palette = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 3v4" />{dot(15.5, 6.5, 1.3)} {dot(19, 11, 1.3)} {dot(16.5, 16.5, 1.3)} {dot(8, 17, 1.3)}</>);
export const Paperclip = icon(<path d="M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 6" />);
export const Pause = icon(<path d="M8 4v16M16 4v16" strokeWidth="2.5" />);
export const PenTool = icon(<><path d="M12 3l8 8-9 9-8-8z" /><path d="M7 13l4 4" />{dot(12, 12, 1.2)}</>);
export const Percent = icon(<><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /><path d="M19 5L5 19" /></>);
export const Play = icon(<path d="M8 4l12 8-12 8z" />);
export const Plus = icon(<path d="M12 4v16M4 12h16" />);
export const PlusCircle = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>);
export const Receipt = icon(<><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></>);
export const RefreshCw = icon(<><path d="M20 12a8 8 0 01-13.7 5.7M4 12a8 8 0 0113.7-5.7" /><path d="M18 3v4h-4M6 21v-4h4" /></>);
export const Save = icon(<><path d="M4 3h12l4 4v14H4z" /><path d="M8 3v6h8M8 21v-6h8v6" /></>);
export const Search = icon(<><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></>);
export const Send = icon(<path d="M21 3L2 11l7 3 3 7zM21 3l-9 8" />);
export const Settings = icon(<><circle cx="12" cy="12" r="3.5" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" /></>);
export const Shield = icon(<path d="M12 3l8 3v6c0 4.5-3.4 7.7-8 9-4.6-1.3-8-4.5-8-9V6z" />);
export const ShieldAlert = icon(<><path d="M12 3l8 3v6c0 4.5-3.4 7.7-8 9-4.6-1.3-8-4.5-8-9V6z" /><path d="M12 8v4M12 15v.5" /></>);
export const ShieldCheck = icon(<><path d="M12 3l8 3v6c0 4.5-3.4 7.7-8 9-4.6-1.3-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5L16 9.5" /></>);
export const ShoppingBag = icon(<><path d="M5 8h14l1 13H4z" /><path d="M9 8V6a3 3 0 016 0v2" /></>);
export const ShoppingCart = icon(<><path d="M2 4h3l3 11h10l2-7H6" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></>);
export const SkipBack = icon(<><path d="M19 5v14L8 12z" strokeWidth="1.2" /><path d="M5 4v16" /></>);
export const SkipForward = icon(<><path d="M5 5v14l11-7z" strokeWidth="1.2" /><path d="M19 4v16" /></>);
export const Smartphone = icon(<><rect x="6" y="2" width="12" height="20" /><path d="M10 18h4" /></>);
export const Smile = icon(<><circle cx="12" cy="12" r="9" /><path d="M8 14c1 1.8 2.4 2.5 4 2.5s3-.7 4-2.5M9 9.5h.5M14.5 9.5h.5" /></>);
export const Star = icon(<path d="M12 3l2.8 6 6.2.8-4.5 4.4 1.1 6.3L12 17.6l-5.6 2.9 1.1-6.3L3 9.8 9.2 9z" />);
export const Sun = icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></>);
export const Tag = icon(<><path d="M20 4h-7l-9 9 7 7 9-9z" />{dot(16, 8, 1.3)}</>);
export const Target = icon(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" />{dot(12, 12, 1.4)}</>);
export const Thermometer = icon(<><path d="M12 3a2 2 0 00-2 2v9a4 4 0 104 0V5a2 2 0 00-2-2z" /><path d="M12 9v7" /></>);
export const Timer = icon(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6M12 2v3" /></>);
export const Trash2 = icon(<><path d="M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></>);
export const TrendingUp = icon(<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />);
export const Type = icon(<path d="M4 6h16M12 6v14M9 20h6" />);
export const Undo2 = icon(<path d="M4 10h10a5 5 0 010 10h-4M4 10l5-5M4 10l5 5" />);
export const User = icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>);
export const Users = icon(<><circle cx="9" cy="8" r="3.5" /><path d="M2 21c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5" /><path d="M16 5.2A3.5 3.5 0 0116 12M18 15.5c2.4.7 4 2.3 4 5.5" /></>);
export const Utensils = icon(<><path d="M7 3v8a2 2 0 004 0V3M9 11v10" /><path d="M16 3c-1.5 1-2 2.5-2 4.5S15 11 16 11s2-.5 2-3.5S17.5 4 16 3zM16 11v10" /></>);
export const Wallet = icon(<><rect x="3" y="6" width="18" height="13" /><path d="M3 10h18M16 14h2" /></>);
export const Waves = icon(<path d="M2 8c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2M2 14c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" />);
export const Wind = icon(<path d="M3 8h11a3 3 0 10-3-3M3 16h13a3 3 0 11-3 3M3 12h8" />);
export const X = icon(<path d="M5 5l14 14M19 5L5 19" />);
export const Zap = icon(<path d="M13 2L4 14h6l-1 8 9-12h-6z" />);
