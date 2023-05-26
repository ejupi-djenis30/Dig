import 'package:Dig/reload.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'home.dart';

void main() {
  runApp(DigBrowser());
}

class DigBrowser extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Dig Browser',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: DigHomePage(title: 'Dig Browser'),
    );
  }
}

class DigHomePage extends StatefulWidget {
  DigHomePage({Key? key, required this.title}) : super(key: key);
  final String title;

  @override
  _DigHomePageState createState() => _DigHomePageState();
}

class _DigHomePageState extends State<DigHomePage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late HomeWidget homeWidget;
  bool isFavorite = false;
  late bool showAppBar;
  late TextEditingController _searchController;
  bool isLoading = false;
  late ReloadButton reloadButton;

  @override
  void initState() {
    super.initState();
    homeWidget = HomeWidget();
    _tabController = TabController(length: 5, vsync: this);
    showAppBar = _tabController.index == 0 && homeWidget.tabs.isNotEmpty;
    _tabController.addListener(_handleTabCountChanged);
    _searchController = TextEditingController();
    reloadButton = ReloadButton(isLoading: isLoading);
  }

  void _handleTabCountChanged() {
    setState(() {
      showAppBar = _tabController.index == 0 && homeWidget.tabs.isNotEmpty;
      isLoading = reloadButton.isLoading;
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _startReloadAnimation() {
    setState(() {
      isLoading = true;
    });
  }

  void _stopReloadAnimation() {
    setState(() {
      isLoading = false;
    });
  }

  void _handleKeyEvent(RawKeyEvent event) {
    if (event is RawKeyDownEvent && event.logicalKey == LogicalKeyboardKey.enter) {
      _startReloadAnimation();
      print("helloooo");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: showAppBar
          ? AppBar(
        backgroundColor: Color(0xFF2E2E2E),
        automaticallyImplyLeading: true,
        leading: ReloadButton(isLoading: isLoading),
        title: RawKeyboardListener(
          focusNode: FocusNode(),
          onKey: _handleKeyEvent,
          child: TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: 'Search',
              hintStyle: TextStyle(
                fontFamily: 'Poppins',
                color: Color(0xFF454545),
              ),
              enabledBorder: UnderlineInputBorder(
                borderSide: BorderSide(
                  color: Color(0xFFE8E8E8),
                  width: 1,
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              focusedBorder: UnderlineInputBorder(
                borderSide: BorderSide(
                  color: Color(0xFF5C5C5C),
                  width: 1,
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              errorBorder: UnderlineInputBorder(
                borderSide: BorderSide(
                  color: Color(0xFFFF7F7F),
                  width: 1,
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              focusedErrorBorder: UnderlineInputBorder(
                borderSide: BorderSide(
                  color: Color(0xFFFF7F7F),
                  width: 1,
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              filled: true,
              fillColor: Color(0xFFB9B9B9),
              suffixIcon: IconButton(
                icon: Icon(
                  Icons.http,
                  color: Color(0xFF454545),
                ),
                onPressed: () {
                  _startReloadAnimation();
                  print("object");
                },
              ),
            ),
            style: TextStyle(
              fontFamily: 'Poppins',
              color: Color(0xFF2E2E2E),
            ),
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(
              isFavorite ? Icons.star : Icons.star_outline_rounded,
              color: Color(0xFFB9B9B9),
              size: 24,
            ),
            onPressed: () {
              setState(() {
                isFavorite = !isFavorite;
              });
              print('PreferedButton pressed ...');
            },
          ),
        ],
        centerTitle: true,
        elevation: 4,
      )
          : null,
      body: TabBarView(
        controller: _tabController,
        children: [
          homeWidget,
          Container(),
          Container(),
          Container(),
          Container(),
        ],
      ),
      bottomNavigationBar: TabBar(
        controller: _tabController,
        unselectedLabelColor: Color(0xFFB9B9B9),
        labelColor: Color(0xFF2E2E2E),
        indicatorColor: Color(0xFF2E2E2E),
        tabs: [
          Tab(
            icon: Icon(Icons.home),
          ),
          Tab(
            icon: Icon(Icons.history),
          ),
          Tab(
            icon: Icon(Icons.star),
          ),
          Tab(
            icon: Icon(Icons.settings),
          ),
          Tab(
            icon: Icon(Icons.download),
          ),
        ],
      ),
    );
  }
}
