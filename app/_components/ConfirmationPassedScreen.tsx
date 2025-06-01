import React, { useEffect } from "react";
import { Box, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";

interface ConfirmationPassedScreenProps {
  onClose: () => void;
}

export function ConfirmationPassedScreen({
  onClose,
}: ConfirmationPassedScreenProps) {
  const t = useTranslations("ConfirmationPassedScreen");
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
        bgcolor: "#d0f2d0",
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
      <CheckCircleOutlineIcon sx={{ fontSize: 80, color: "green", mb: 3 }} />
      <Typography variant="h4" sx={{ mb: 2 }}>
        {t("successTitle")}
      </Typography>
      <Typography variant="body1" sx={{ mb: 4, opacity: 0.9 }}>
        {t("successMessage")}
      </Typography>
    </Box>
  );
}
