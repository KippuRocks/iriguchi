"use client";

import React, { useEffect } from "react";
import { Box, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

const ConfirmationFailedScreen = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslations("ConfirmationFailedScreen");
  useEffect(() => {
    setTimeout(onClose, 2000);
  });
  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100dvh",
        bgcolor: "#fdecea",
        zIndex: (theme) => theme.zIndex.modal + 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        color: "black",
        p: 2,
      }}
    >
      <ErrorOutlineIcon sx={{ fontSize: 80, color: "red", mb: 3 }} />
      <Typography variant="h4" sx={{ mb: 2 }}>
        {t("failedTitle")}
      </Typography>
      <Typography variant="body1" sx={{ mb: 4, opacity: 0.9 }}>
        {t("failedMessage")}
      </Typography>
    </Box>
  );
};

export default ConfirmationFailedScreen;
