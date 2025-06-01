"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Box, Typography, CircularProgress, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslations } from "next-intl";

let isAlreadyInstantiaded = false;
let shouldStop = false;

export default function QrScanner({
  onResult,
  onClose,
}: {
  onResult: (result: Uint8Array) => void;
  onClose: () => void;
}) {
  const t = useTranslations("QrScanner");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const codeReader = new BrowserMultiFormatReader();
    function removeListeners() {
      BrowserMultiFormatReader.releaseAllStreams();
      isAlreadyInstantiaded = false;
      shouldStop = true;
      window.removeEventListener("stopVideo", removeListeners);
    }
    async function initializeVideo() {
      window.addEventListener("stopVideo", removeListeners);
      shouldStop = false;
      await navigator.permissions.query({
        name: "camera",
      });
      //const media = await navigator.mediaDevices.getUserMedia({ video: true });

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      const camera =
        devices.find((d) => d.label.toLowerCase().includes("back")) ||
        devices[0];
      setLoading(false);
      while (!shouldStop) {
        const result = await codeReader.decodeOnceFromVideoDevice(
          camera?.deviceId,
          videoRef.current!
        );

        if (result) {
          if (navigator.vibrate) navigator.vibrate(200);
          const binary = window.atob(result.getText());
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          onResult(bytes);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    if (!isAlreadyInstantiaded) {
      isAlreadyInstantiaded = true;
      initializeVideo();
    }
  }, [onResult]);

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        backgroundColor: "black",
        zIndex: (theme) => theme.zIndex.modal,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <video
        ref={videoRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
        autoPlay
        muted
        playsInline
      />

      {loading && (
        <Box
          sx={{
            position: "absolute",
            top: "10%",
            color: "white",
            textAlign: "center",
          }}
        >
          <CircularProgress color="inherit" />
          <Typography variant="body1" sx={{ mt: 2 }}>
            {t("loadingCamera")}
          </Typography>
        </Box>
      )}

      <Box
        sx={{
          position: "absolute",
          border: "2px solid white",
          width: 240,
          height: 240,
          borderRadius: 2,
        }}
      />

      <IconButton
        onClick={onClose}
        sx={{
          position: "absolute",
          top: 16,
          right: 16,
          color: "white",
          backgroundColor: "rgba(0,0,0,0.5)",
          ":hover": { backgroundColor: "rgba(0,0,0,0.7)" },
        }}
        aria-label={t("close")}
      >
        <CloseIcon />
      </IconButton>
    </Box>
  );
}
