import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://cfegswppqthtdrwegoc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmZWdzd3BwcXR0aHRkcndlZ29jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzI0ODgsImV4cCI6MjA5MTQwODQ4OH0.Il8yoT-7n9ocgG9D0_PqFGjoDUmnX2cELcgrfnS7ieY'
)
