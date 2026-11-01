// A rule across the pane that comes alive while something is under way (a
// list loading, checks running): a bright dot runs along it, trailing a
// fainter one. At rest it's a plain dim line. It ticks on the surface's own
// frame clock, so only this line redraws, never the pane.
import type { ClientModule } from 'claude-code'

type Props = { active: boolean; color: string; width: number }
type Ref = { phase: number; active: boolean }
type State = { ref: Ref }

const STEP_MS = 90
// One dot per this many cells.
const GAP = 28

const Rail: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { phase: 0, active: props.active }
  ref.active = props.active
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      if (ref.active) {
        ref.phase += 1
        surface.setState({ ref })
      }
    })
  }
  const width = Math.max(1, surface.columns || props.width)
  if (!props.active) {
    return (
      <Box width={width} overflow="hidden">
        <Text color="subtle" dimColor mono>{'─'.repeat(width)}</Text>
      </Box>
    )
  }
  // Runs of the same look share a Text: a handful of nodes a frame.
  const lit = new Map<number, string>()
  for (let base = 0; base < width + GAP; base += GAP) {
    const head = (base + ref.phase) % (width + GAP)
    if (head < width) lit.set(head, '●')
    if (head - 1 >= 0 && head - 1 < width) lit.set(head - 1, '•')
  }
  const runs: { text: string; isLit: boolean }[] = []
  for (let i = 0; i < width; i++) {
    const glyph = lit.get(i)
    const isLit = glyph !== undefined
    const last = runs[runs.length - 1]
    if (last && last.isLit === isLit) last.text += glyph ?? '─'
    else runs.push({ text: glyph ?? '─', isLit })
  }
  return (
    <Box width={width} overflow="hidden">
      <Box flexShrink={0}>
        {runs.map(r => (
          <Text color={r.isLit ? props.color : 'subtle'} weight={r.isLit ? 'bold' : undefined} dimColor={!r.isLit || undefined} mono>
            {r.text}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

export default Rail
