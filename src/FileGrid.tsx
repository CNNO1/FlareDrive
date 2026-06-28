import React from "react";
import {
  Box,
  Grid,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import MimeIcon from "./MimeIcon";
import { humanReadableSize } from "./app/utils";
import { getWebDavAuthHeader } from "./app/auth";

export interface FileItem {
  key: string;
  size: number;
  uploaded: string;
  httpMetadata: { contentType: string };
  customMetadata?: { thumbnail?: string };
}

function extractFilename(key: string) {
  return key.split("/").pop();
}

export function encodeKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function isDirectory(file: FileItem) {
  return file.httpMetadata?.contentType === "application/x-directory";
}

function AuthenticatedThumbnail({ file }: { file: FileItem }) {
  const [src, setSrc] = React.useState<string | null>(null);
  const thumbnail = file.customMetadata?.thumbnail;

  React.useEffect(() => {
    if (!thumbnail) return;
    let active = true;
    let objectUrl: string | null = null;

    fetch(`/webdav/_$flaredrive$/thumbnails/${thumbnail}.png`, {
      headers: getWebDavAuthHeader(),
    })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => setSrc(null));

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [thumbnail]);

  if (!src) return <MimeIcon contentType={file.httpMetadata.contentType} />;

  return (
    <img
      src={src}
      alt={file.key}
      style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }}
    />
  );
}

function FileGrid({
  files,
  onCwdChange,
  onOpenFile,
  multiSelected,
  onMultiSelect,
  emptyMessage,
}: {
  files: FileItem[];
  onCwdChange: (newCwd: string) => void;
  onOpenFile: (file: FileItem) => void;
  multiSelected: string[] | null;
  onMultiSelect: (key: string) => void;
  emptyMessage?: React.ReactNode;
}) {
  return files.length === 0 ? (
    emptyMessage
  ) : (
    <Grid
      container
      spacing={0.5}
      sx={{ padding: { xs: 1, sm: 2 }, paddingBottom: "96px" }}
    >
      {files.map((file) => (
        <Grid item key={file.key} xs={12} sm={6} md={4} lg={3} xl={2}>
          <ListItemButton
            selected={multiSelected?.includes(file.key)}
            onClick={() => {
              if (multiSelected !== null) {
                onMultiSelect(file.key);
              } else if (isDirectory(file)) {
                onCwdChange(file.key + "/");
              } else onOpenFile(file);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onMultiSelect(file.key);
            }}
            sx={{
              minHeight: 72,
              userSelect: "none",
              borderRadius: 1,
              "&.Mui-selected": {
                backgroundColor: "rgba(37, 99, 235, 0.12)",
              },
            }}
          >
            <ListItemIcon>
              <AuthenticatedThumbnail file={file} />
            </ListItemIcon>
            <ListItemText
              primary={extractFilename(file.key)}
              primaryTypographyProps={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              secondary={
                <React.Fragment>
                  <Box
                    sx={{
                      display: "inline-block",
                      marginRight: 1,
                    }}
                  >
                    {new Date(file.uploaded).toLocaleString()}
                  </Box>
                  {!isDirectory(file) && humanReadableSize(file.size)}
                </React.Fragment>
              }
            />
          </ListItemButton>
        </Grid>
      ))}
    </Grid>
  );
}

export default FileGrid;
