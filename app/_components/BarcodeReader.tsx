"use client";

import { useEffect, useState } from "react";
import { Box, Typography, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import BarcodeReaderIcon from "@mui/icons-material/BarcodeReader";

type BarcodeReaderProps = {
  message: string;
  onBarcode: (text: Uint8Array) => void;
  onClose: () => void;
};

export default function BarcodeReader({
  message,
  onBarcode,
  onClose,
}: BarcodeReaderProps) {
  const [input, setInput] = useState("");
  const [shouldIgnoreInput, setShouldIgnoreInput] = useState(false);

  useEffect(() => {
    setTimeout(() => setShouldIgnoreInput(false), 3000);
  }, [shouldIgnoreInput]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreInput) {
        return;
      }
      if (event.key === "Enter") {
        console.log(window.atob(input));
        const binary = window.atob(input);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        setShouldIgnoreInput(true);
        onBarcode(bytes);
        setInput("");
      } else if (event.key.length === 1) {
        setInput((prev) => prev + event.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [input, onBarcode]);

  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100dvh",
        background: "white",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        zIndex: (theme) => theme.zIndex.modal,
      }}
    >
      <IconButton
        onClick={onClose}
        sx={{
          position: "absolute",
          top: 16,
          right: 16,
          color: "black",
        }}
      >
        <CloseIcon />
      </IconButton>
      <Typography
        variant="h4"
        sx={{
          opacity: 0.8,
          mb: 4,
          textAlign: "center",
          fontSize: 14,
        }}
      >
        {message}
      </Typography>
      {/* Placeholder for barcode reader UI */}
      <BarcodeReaderIcon sx={{ width: 40, height: 40 }} />
      {/* <Box sx={{ width: 300, height: 200, bgcolor: "#222", borderRadius: 2 }} /> */}
    </Box>
  );
}
