import type { AttachmentKind, MilestoneKind } from '../lib/types'
import { cx } from './ui'

/**
 * Line icons for the fixed vocabularies that used to be emoji.
 *
 * All drawn on the same 24-unit grid with the same stroke weight, so a row of
 * them looks like one set rather than whatever each platform's emoji font
 * decided. Every one inherits `currentColor`, so they take the tone of
 * whatever they sit inside.
 */
type IconProps = { className?: string }

const S = (className?: string) => ({
  viewBox: '0 0 24 24',
  className: cx('h-4 w-4', className),
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export const DocIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
)
export const DesignIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /></svg>
)
export const RepoIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><path d="m9 18-6-6 6-6M15 6l6 6-6 6" /></svg>
)
export const VideoIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3z" /></svg>
)
export const SheetIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10M3 15h18" /></svg>
)
export const LinkIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
)

export const RegistrationIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
)
export const BuildIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><path d="M14.7 6.3a4 4 0 0 1 5 5L9 22l-5-5z" /><path d="m14 8 2 2" /></svg>
)
export const SubmissionIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8M3 8l9-5 9 5-9 5z" /></svg>
)
export const DemoIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M9 20h6M12 16v4" /></svg>
)
export const FlagIcon = ({ className }: IconProps) => (
  <svg {...S(className)}><path d="M4 21V4h9l.6 2H20v9h-7l-.6-2H4" /></svg>
)

export const ATTACHMENT_ICON: Record<AttachmentKind, (p: IconProps) => React.ReactElement> = {
  doc: DocIcon, design: DesignIcon, repo: RepoIcon,
  video: VideoIcon, sheet: SheetIcon, other: LinkIcon,
}

export const MILESTONE_ICON: Record<MilestoneKind, (p: IconProps) => React.ReactElement> = {
  registration: RegistrationIcon,
  build: BuildIcon,
  submission: SubmissionIcon,
  // 'judging' survives only as an enum member; judging itself was removed.
  judging: FlagIcon,
  demo: DemoIcon,
  custom: FlagIcon,
}
