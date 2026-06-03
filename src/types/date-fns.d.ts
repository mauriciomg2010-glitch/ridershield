declare module 'date-fns' {
  export function formatDistanceToNow(
    date: Date | number,
    options?: {
      includeSeconds?: boolean
      addSuffix?: boolean
      locale?: object
    }
  ): string
}
