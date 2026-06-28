import {
  Box,
  Chip,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";
import {
  CloudQueue as CloudQueueIcon,
  Logout as LogoutIcon,
  MoreHoriz as MoreHorizIcon,
  Search as SearchIcon,
} from "@mui/icons-material";

function Header({
  search,
  onSearchChange,
  setShowProgressDialog,
  onLogout,
}: {
  search: string;
  onSearchChange: (newSearch: string) => void;
  setShowProgressDialog: (show: boolean) => void;
  onLogout: () => void;
}) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  return (
    <Toolbar
      disableGutters
      sx={{
        gap: 1.25,
        minHeight: "64px",
        paddingX: { xs: 1, sm: 2 },
        borderBottom: "1px solid",
        borderColor: "divider",
        backgroundColor: "background.paper",
      }}
    >
      <StackedBrand />
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 1,
          backgroundColor: "#f1f5f9",
          borderRadius: "999px",
          paddingX: 1.5,
          height: 40,
        }}
      >
        <SearchIcon fontSize="small" color="action" />
        <InputBase
          size="small"
          fullWidth
          placeholder="搜索文件"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          sx={{ minWidth: 0 }}
        />
      </Box>
      <Chip
        label="建议上限 3GB"
        size="small"
        color="secondary"
        variant="outlined"
        sx={{ display: { xs: "none", md: "inline-flex" } }}
      />
      <Tooltip title="退出登录">
        <IconButton aria-label="退出登录" color="inherit" onClick={onLogout}>
          <LogoutIcon />
        </IconButton>
      </Tooltip>
      <IconButton
        aria-label="更多"
        color="inherit"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreHorizIcon />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            setShowProgressDialog(true);
          }}
        >
          传输记录
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onLogout();
          }}
        >
          退出登录
        </MenuItem>
      </Menu>
    </Toolbar>
  );
}

function StackedBrand() {
  return (
    <Box
      sx={{
        display: { xs: "none", sm: "flex" },
        alignItems: "center",
        gap: 1,
        minWidth: 188,
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 1,
          display: "grid",
          placeItems: "center",
          color: "common.white",
          backgroundColor: "primary.main",
        }}
      >
        <CloudQueueIcon fontSize="small" />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ lineHeight: 1.15 }}>
          FlareDrive
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Light
        </Typography>
      </Box>
    </Box>
  );
}

export default Header;
