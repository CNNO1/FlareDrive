import React, { useState } from "react";
import {
  IconButton,
  Menu,
  MenuItem,
  Slide,
  Toolbar,
  Tooltip,
} from "@mui/material";
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  MoreHoriz as MoreHorizIcon,
} from "@mui/icons-material";

function MultiSelectToolbar({
  multiSelected,
  onClose,
  onDownload,
  onRename,
  onDelete,
  onShare,
}: {
  multiSelected: string[] | null;
  onClose: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onShare: () => void;
}) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  return (
    <Slide direction="up" in={multiSelected !== null}>
      <Toolbar
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          backgroundColor: (theme) => theme.palette.background.paper,
          borderTop: "1px solid lightgray",
          justifyContent: "space-evenly",
        }}
      >
        <Tooltip title="取消选择">
          <IconButton color="primary" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="下载">
          <span>
            <IconButton
              color="primary"
              disabled={
                multiSelected?.length !== 1 || multiSelected[0].endsWith("/")
              }
              onClick={onDownload}
            >
              <DownloadIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="删除">
          <IconButton color="primary" onClick={onDelete}>
            <DeleteIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="更多">
          <span>
            <IconButton
              color="primary"
              disabled={
                multiSelected?.length !== 1 || multiSelected[0].endsWith("/")
              }
              onClick={(e) => setAnchorEl(e.currentTarget)}
            >
              <MoreHorizIcon />
            </IconButton>
          </span>
        </Tooltip>
        {multiSelected?.length && (
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
          >
            {multiSelected.length === 1 && (
              <React.Fragment>
                <MenuItem
                  onClick={() => {
                    setAnchorEl(null);
                    onRename();
                  }}
                >
                  重命名
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setAnchorEl(null);
                    onShare();
                  }}
                >
                  复制地址
                </MenuItem>
              </React.Fragment>
            )}
          </Menu>
        )}
      </Toolbar>
    </Slide>
  );
}

export default MultiSelectToolbar;
