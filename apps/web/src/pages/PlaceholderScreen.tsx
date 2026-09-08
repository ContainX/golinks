import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

export interface PlaceholderScreenProps {
  /** Rendered as the page's only heading. */
  title: string
  /** One sentence saying what this route will hold. */
  description: string
  children?: ReactNode
}

/**
 * Stand-in for a screen that has not been designed yet.
 *
 * Every route renders one of these. They exist to prove the router, the theme,
 * and the query client are wired together; the layout, navigation, and visual
 * design of the app are decided in the UX design step (spec 08 §9) and nothing
 * here should be read as a proposal for them.
 */
export function PlaceholderScreen({ title, description, children }: PlaceholderScreenProps) {
  return (
    <Box component="section">
      <Typography variant="h1">{title}</Typography>
      <Typography>{description}</Typography>
      {children}
    </Box>
  )
}
