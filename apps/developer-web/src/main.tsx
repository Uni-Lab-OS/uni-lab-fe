import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@ant-design/v5-patch-for-react-19";
import { ConfigProvider, theme as antdTheme } from "antd";
import {
  configureTheme,
  createAntdTheme,
  getTheme,
  watchTheme,
} from "@unilab/design-v2";
import "@unilab/design-v2/icons/styles.css";
import "@unilab/lab-ui/styles.css";
import "@unilab/lab-ui/material-inspector.css";
import "antd/dist/reset.css";
import "./styles/index.css";
import { App } from "./App";

configureTheme({ defaultMode: "light", defaultPreset: "default" });

function DesignSystemRoot() {
  const [designTheme, setDesignTheme] = useState(getTheme());
  useEffect(() => watchTheme(setDesignTheme), []);
  const antdConfig = useMemo(
    () =>
      createAntdTheme(designTheme, {
        defaultAlgorithm: antdTheme.defaultAlgorithm,
        darkAlgorithm: antdTheme.darkAlgorithm,
      }),
    [designTheme],
  );

  return (
    <ConfigProvider theme={antdConfig}>
      <App />
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesignSystemRoot />
  </StrictMode>,
);
