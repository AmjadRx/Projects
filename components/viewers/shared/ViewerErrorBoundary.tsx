'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a viewer engine that throws (no WebGL, a damaged file, a blocked worker) and shows the
 * fallback instead: the poster, a short message, and the download link stay on the page.
 */
export default class ViewerErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Viewer failed to load', error, info.componentStack);
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
