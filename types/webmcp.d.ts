import "react";

/* JSX declaration merging requires preserving React's generic interface shapes. */
/* eslint-disable @typescript-eslint/no-unused-vars */

declare module "react" {
  interface HTMLAttributes<T> {
    toolname?: string;
    tooldescription?: string;
    toolparamdescription?: string;
  }

  interface FormHTMLAttributes<T> {
    toolname?: string;
    tooldescription?: string;
  }

  interface InputHTMLAttributes<T> {
    toolparamdescription?: string;
  }
}
