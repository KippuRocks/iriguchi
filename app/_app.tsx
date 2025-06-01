import { NextComponentType, NextPageContext } from "next";
import { appWithTranslation } from "next-i18next";
import { AppProps } from "next/app";

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: NextComponentType<NextPageContext, any, any>;
  pageProps: AppProps;
}

function MyApp({ Component, pageProps }: Props) {
  throw new Error("");
  return <Component {...pageProps} />;
}

export default appWithTranslation(MyApp);
