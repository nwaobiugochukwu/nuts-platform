"use client";

import NextLink from "next/link";
import { forwardRef, type ComponentProps } from "react";

type AppLinkProps = ComponentProps<typeof NextLink>;

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(
  function AppLink(props, ref) {
    return <NextLink {...props} ref={ref} prefetch={false} />;
  },
);

AppLink.displayName = "AppLink";

export default AppLink;
