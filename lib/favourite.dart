import 'package:flutter/material.dart';

class FavoritePagesWidget extends StatefulWidget {
  final List<String> favoritePages;
  final void Function(String) searchFunction;

  FavoritePagesWidget(
      {required this.favoritePages, required this.searchFunction});

  @override
  _FavoritePagesWidgetState createState() => _FavoritePagesWidgetState();
}

class _FavoritePagesWidgetState extends State<FavoritePagesWidget> {
  List<String> favoritePages = [];

  @override
  void initState() {
    super.initState();
    favoritePages = widget.favoritePages;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      child: favoritePages.isEmpty
          ? Center(
              child: Text(
                'No Favorite Pages',
                style: TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.bold,
                ),
              ),
            )
          : ListView.builder(
              itemCount: favoritePages.length,
              itemBuilder: (context, index) {
                final page = favoritePages[index];
                return ListTile(
                  onTap: () {
                    widget.searchFunction(page);
                  },
                  leading: Image.asset(
                    'assets/gopher.png',
                    width: 24,
                    height: 24,
                    color: Color(0xFF2E2E2E),
                  ),
                  title: Text(page),
                  trailing: IconButton(
                    icon: Icon(
                      Icons.star_border,
                      color: Color(0xFF2E2E2E),
                    ),
                    onPressed: () {
                      setState(() {
                        favoritePages.removeAt(index);
                      });
                    },
                  ),
                );
              },
            ),
    );
  }
}
