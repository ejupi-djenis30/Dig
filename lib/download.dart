import 'package:flutter/material.dart';

enum FileType {
  video,
  audio,
  image,
  document,
  other,
}

class DownloadHistoryWidget extends StatefulWidget {
  final List<String> downloadItems;

  DownloadHistoryWidget({required this.downloadItems});

  @override
  _DownloadHistoryWidgetState createState() => _DownloadHistoryWidgetState();
}

class _DownloadHistoryWidgetState extends State<DownloadHistoryWidget> {
  List<String> downloadItems = [];

  @override
  void initState() {
    super.initState();
    downloadItems = widget.downloadItems;
  }

  void clearDownloadHistory() {
    setState(() {
      downloadItems.clear();
    });
  }

  void removeDownloadItem(int index) {
    setState(() {
      downloadItems.removeAt(index);
    });
  }

  IconData getIconForFileType(FileType fileType) {
    switch (fileType) {
      case FileType.video:
        return Icons.videocam;
      case FileType.audio:
        return Icons.audiotrack;
      case FileType.image:
        return Icons.image;
      case FileType.document:
        return Icons.description;
      default:
        return Icons.insert_drive_file;
    }
  }

  FileType getFileTypeFromFileName(String fileName) {
    final extension = fileName.split('.').last.toLowerCase();

    if (extension == 'mp4' || extension == 'mov') {
      return FileType.video;
    } else if (extension == 'mp3' || extension == 'wav') {
      return FileType.audio;
    } else if (extension == 'jpg' || extension == 'png' || extension == 'gif') {
      return FileType.image;
    } else if (extension == 'pdf' || extension == 'doc' || extension == 'txt') {
      return FileType.document;
    } else {
      return FileType.other;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (downloadItems.isNotEmpty)
          Container(
            alignment: Alignment.center,
            child: IconButton(
              icon: Icon(Icons.delete),
              color: Color(0xFF2E2E2E),
              onPressed: () {
                clearDownloadHistory();
              },
            ),
          ),
        if (downloadItems.isNotEmpty)
          Divider(
            color: Color(0xFF2E2E2E),
            thickness: 1.0,
          ),
        Expanded(
          child: downloadItems.isEmpty
              ? Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'Empty Download History',
                      style: TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                )
              : ListView.builder(
                  itemCount: downloadItems.length,
                  itemBuilder: (BuildContext context, int index) {
                    final item = downloadItems[index];
                    final fileType = getFileTypeFromFileName(item);
                    final fileIcon = getIconForFileType(fileType);

                    return ListTile(
                      leading: Icon(
                        fileIcon,
                        color: Color(0xFF2E2E2E),
                      ),
                      title: Text(item),
                      trailing: IconButton(
                        icon: Icon(Icons.delete_outline),
                        color: Color(0xFF2E2E2E),
                        onPressed: () {
                          removeDownloadItem(index);
                        },
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
